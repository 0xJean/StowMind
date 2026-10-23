//! Preserve measurement precision after cleanup without inferring disk savings.

use super::types::{AgentCleanupAction, AgentCleanupSizeStatus};

pub(super) fn measured_action(
    path: String,
    bytes: Option<u64>,
    status: &str,
    success: bool,
    message: String,
) -> AgentCleanupAction {
    let size_status = match (bytes, status) {
        (Some(_), "complete") => AgentCleanupSizeStatus::Complete,
        (Some(_), "partial") => AgentCleanupSizeStatus::Partial,
        _ => AgentCleanupSizeStatus::Unavailable,
    };
    AgentCleanupAction {
        path,
        size_bytes: if size_status == AgentCleanupSizeStatus::Unavailable {
            None
        } else {
            bytes
        },
        size_status,
        success,
        message,
    }
}

pub(super) fn processed_measurement(
    actions: &[AgentCleanupAction],
) -> (Option<u64>, AgentCleanupSizeStatus) {
    let mut bytes = 0_u64;
    let mut has_success = false;
    let mut has_measurement = false;
    let mut complete = true;
    for action in actions.iter().filter(|action| action.success) {
        has_success = true;
        complete &= action.size_status == AgentCleanupSizeStatus::Complete;
        match (action.size_bytes, action.size_status) {
            (Some(size), AgentCleanupSizeStatus::Complete | AgentCleanupSizeStatus::Partial) => {
                // Never turn an overflow into an apparently exact saturated sum.
                let Some(sum) = bytes.checked_add(size) else {
                    return (None, AgentCleanupSizeStatus::Unavailable);
                };
                bytes = sum;
                has_measurement = true;
            }
            _ => complete = false,
        }
    }
    if !has_success {
        return (Some(0), AgentCleanupSizeStatus::Complete);
    }
    if !has_measurement {
        return (None, AgentCleanupSizeStatus::Unavailable);
    }
    (
        Some(bytes),
        if complete {
            AgentCleanupSizeStatus::Complete
        } else {
            AgentCleanupSizeStatus::Partial
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{measured_action, processed_measurement};
    use crate::stowmind_supplements::agent_cleanup::types::{
        AgentCleanupAction, AgentCleanupSizeStatus as Status,
    };

    fn action(bytes: Option<u64>, status: &str, success: bool) -> AgentCleanupAction {
        measured_action(
            "anonymous-cache".into(),
            bytes,
            status,
            success,
            "result".into(),
        )
    }

    #[test]
    fn action_keeps_partial_zero_distinct_from_complete_zero_and_unknown() {
        let complete = action(Some(0), "complete", true);
        let partial = action(Some(0), "partial", true);
        let unavailable = action(Some(0), "unavailable", true);
        assert_eq!(
            (complete.size_bytes, complete.size_status),
            (Some(0), Status::Complete)
        );
        assert_eq!(
            (partial.size_bytes, partial.size_status),
            (Some(0), Status::Partial)
        );
        assert_eq!(
            (unavailable.size_bytes, unavailable.size_status),
            (None, Status::Unavailable)
        );
    }

    #[test]
    fn absent_or_unrecognized_measurements_cannot_be_promoted_to_complete() {
        for candidate in [
            action(None, "complete", true),
            action(Some(512), "future-status", true),
        ] {
            assert_eq!(candidate.size_bytes, None);
            assert_eq!(candidate.size_status, Status::Unavailable);
        }
    }

    #[test]
    fn complete_successes_sum_without_failed_or_skipped_candidates() {
        assert_eq!(
            processed_measurement(&[
                action(Some(64), "complete", true),
                action(Some(128), "complete", true),
                action(Some(2048), "partial", false),
                action(None, "unavailable", false),
            ]),
            (Some(192), Status::Complete)
        );
    }

    #[test]
    fn successful_partial_measurements_preserve_the_known_lower_bound() {
        assert_eq!(
            processed_measurement(&[
                action(Some(64), "complete", true),
                action(Some(128), "partial", true),
            ]),
            (Some(192), Status::Partial)
        );
        assert_eq!(
            processed_measurement(&[action(Some(0), "partial", true)]),
            (Some(0), Status::Partial)
        );
    }

    #[test]
    fn git_post_measurement_failure_preserves_other_successful_bytes_as_partial() {
        assert_eq!(
            processed_measurement(&[
                action(Some(64), "complete", true),
                action(None, "unavailable", true),
            ]),
            (Some(64), Status::Partial)
        );
        assert_eq!(
            processed_measurement(&[action(None, "unavailable", true)]),
            (None, Status::Unavailable)
        );
    }

    #[test]
    fn no_successful_actions_and_known_empty_success_are_confirmed_zero() {
        assert_eq!(processed_measurement(&[]), (Some(0), Status::Complete));
        assert_eq!(
            processed_measurement(&[action(None, "unavailable", false)]),
            (Some(0), Status::Complete)
        );
        assert_eq!(
            processed_measurement(&[action(Some(0), "complete", true)]),
            (Some(0), Status::Complete)
        );
    }

    #[test]
    fn aggregate_overflow_is_unknown_instead_of_exact_saturation() {
        assert_eq!(
            processed_measurement(&[
                action(Some(u64::MAX), "complete", true),
                action(Some(1), "complete", true),
            ]),
            (None, Status::Unavailable)
        );
    }

    #[test]
    fn serialized_actions_preserve_snake_case_precision_contract() {
        let serialized = serde_json::to_value(action(Some(64), "partial", true)).unwrap();
        assert_eq!(serialized["size_bytes"], 64);
        assert_eq!(serialized["size_status"], "partial");
        let unknown = serde_json::to_value(action(None, "unavailable", true)).unwrap();
        assert!(unknown["size_bytes"].is_null());
        assert_eq!(unknown["size_status"], "unavailable");
    }
}
