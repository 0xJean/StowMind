use portable_pty::ChildKiller;
use std::{
    collections::HashMap,
    io::Write,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

struct MoleCleanPtySession {
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Clone, Default)]
pub struct MoleCleanPtyManager {
    sessions: Arc<Mutex<HashMap<String, MoleCleanPtySession>>>,
    cancelled: Arc<Mutex<HashMap<String, Instant>>>,
}

impl MoleCleanPtyManager {
    pub(crate) fn insert(
        &self,
        run_id: String,
        writer: Box<dyn Write + Send>,
        mut killer: Box<dyn ChildKiller + Send + Sync>,
    ) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        if self.is_cancelled(&run_id) {
            let _ = killer.kill();
            return Err("Mole operation was cancelled before it started".to_string());
        }
        if sessions.contains_key(&run_id) {
            let _ = killer.kill();
            return Err("Mole run ID is already active".to_string());
        }
        sessions.insert(run_id, MoleCleanPtySession { writer, killer });
        Ok(())
    }

    pub(crate) fn write(&self, run_id: &str, input: &[u8]) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        let session = sessions
            .get_mut(run_id)
            .ok_or_else(|| "Mole clean scan is no longer running".to_string())?;
        session
            .writer
            .write_all(input)
            .map_err(|e| format!("Failed to write to Mole clean PTY: {e}"))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Failed to flush Mole clean PTY: {e}"))
    }

    pub(crate) fn cancel(&self, run_id: &str) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        let mut cancelled = self
            .cancelled
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        cancelled.retain(|_, time| time.elapsed() < Duration::from_secs(600));
        if cancelled.len() >= 1_000 {
            if let Some(oldest) = cancelled
                .iter()
                .min_by_key(|(_, time)| *time)
                .map(|(id, _)| id.clone())
            {
                cancelled.remove(&oldest);
            }
        }
        cancelled.insert(run_id.to_string(), Instant::now());
        if let Some(mut session) = sessions.remove(run_id) {
            let _ = session.killer.kill();
        }
        Ok(())
    }

    pub(crate) fn is_cancelled(&self, run_id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|runs| {
                runs.get(run_id)
                    .map(|time| time.elapsed() < Duration::from_secs(600))
                    .unwrap_or(false)
            })
            .unwrap_or(true)
    }

    pub(crate) fn remove(&self, run_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(run_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Debug)]
    struct Killer(Arc<AtomicUsize>);
    impl ChildKiller for Killer {
        fn kill(&mut self) -> std::io::Result<()> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(Self(Arc::clone(&self.0)))
        }
    }

    #[test]
    fn cancel_before_registration_kills_the_later_child() {
        let manager = MoleCleanPtyManager::default();
        let kills = Arc::new(AtomicUsize::new(0));
        manager.cancel("starting-cache-review").unwrap();
        assert!(manager
            .insert(
                "starting-cache-review".to_string(),
                Box::new(Vec::<u8>::new()),
                Box::new(Killer(Arc::clone(&kills)))
            )
            .is_err());
        assert_eq!(kills.load(Ordering::SeqCst), 1);
        assert!(manager.write("starting-cache-review", b"secret").is_err());
    }

    #[test]
    fn duplicate_run_ids_preserve_the_existing_session() {
        let manager = MoleCleanPtyManager::default();
        let first = Arc::new(AtomicUsize::new(0));
        let second = Arc::new(AtomicUsize::new(0));
        manager
            .insert(
                "same-id".to_string(),
                Box::new(Vec::<u8>::new()),
                Box::new(Killer(Arc::clone(&first))),
            )
            .unwrap();
        assert!(manager
            .insert(
                "same-id".to_string(),
                Box::new(Vec::<u8>::new()),
                Box::new(Killer(Arc::clone(&second)))
            )
            .is_err());
        assert_eq!(second.load(Ordering::SeqCst), 1);
        assert_eq!(first.load(Ordering::SeqCst), 0);
        manager.cancel("same-id").unwrap();
        assert_eq!(first.load(Ordering::SeqCst), 1);
    }
}
