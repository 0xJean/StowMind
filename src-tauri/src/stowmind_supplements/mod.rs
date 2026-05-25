//! StowMind supplement adapters.
//!
//! These modules intentionally live outside the Mole integration modules. They
//! fill product gaps only when Mole has not exposed a CLI / JSON capability yet,
//! and their API responses must be labeled as `stowmind_supplement`.

pub mod app_updates;
pub mod safe_trash;
