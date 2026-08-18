use super::types::IosLayoutSnapshot;

pub fn has_all_home_screen_pages(snapshot: &IosLayoutSnapshot) -> bool {
    if !matches!(
        snapshot.scan_scope.as_str(),
        "homeScreenPages" | "homeScreenAndAppLibrary"
    ) || snapshot.pages.is_empty()
    {
        return false;
    }

    let mut page_indices = snapshot
        .pages
        .iter()
        .map(|page| page.index)
        .collect::<Vec<_>>();
    page_indices.sort_unstable();
    page_indices.dedup();
    page_indices.into_iter().eq(0..snapshot.pages.len())
}

pub fn require_all_home_screen_pages(snapshot: &IosLayoutSnapshot) -> Result<(), String> {
    if has_all_home_screen_pages(snapshot) {
        return Ok(());
    }
    Err("当前快照只覆盖单个或部分主屏幕页面。请授权辅助功能后重新盘点全部页面。".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(scope: &str, inventory_complete: bool) -> IosLayoutSnapshot {
        IosLayoutSnapshot {
            id: "snapshot".to_string(),
            captured_at: "0".to_string(),
            device_name: None,
            apps: Vec::new(),
            folders: Vec::new(),
            pages: vec![super::super::types::IosPageSnapshot {
                index: 0,
                app_ids: Vec::new(),
                has_widgets: false,
            }],
            dock: Vec::new(),
            inventory_hash: String::new(),
            confidence: 1.0,
            source: "test".to_string(),
            scan_scope: scope.to_string(),
            inventory_complete,
            warnings: Vec::new(),
            window_bounds: None,
        }
    }

    #[test]
    fn single_page_inventory_cannot_drive_a_global_plan() {
        assert!(require_all_home_screen_pages(&snapshot("visibleMirrorPage", false)).is_err());
        assert!(require_all_home_screen_pages(&snapshot("partialHomeScreenPages", false)).is_err());
        assert!(require_all_home_screen_pages(&snapshot("visibleMirrorPage", true)).is_err());
    }

    #[test]
    fn traversed_home_pages_are_enough_for_home_screen_planning() {
        assert!(require_all_home_screen_pages(&snapshot("homeScreenPages", false)).is_ok());
        assert!(require_all_home_screen_pages(&snapshot("homeScreenAndAppLibrary", true)).is_ok());
    }

    #[test]
    fn non_contiguous_page_indices_are_rejected() {
        let mut invalid = snapshot("homeScreenPages", false);
        invalid.pages[0].index = 1;
        assert!(require_all_home_screen_pages(&invalid).is_err());
    }
}
