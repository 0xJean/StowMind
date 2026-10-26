//! Deterministic Home Screen grid model shared by the planner, the Rust
//! safety gate and the execution checkpoints.
//!
//! Only pages whose contents are fully known are modelled. A page is either
//! `Packed` (icons occupy slots `0..n` without gaps) or `Free` (it has gaps).
//! On a packed page a move into the occupied run behaves like SpringBoard's
//! reflow: the icon is removed and re-inserted, shifting only the icons in
//! between. Free pages only accept moves into empty slots. Cross-page moves
//! may only take the last icon on its page and must land in an empty slot
//! (the append slot on packed pages), so no page ever reflows implicitly.
use super::types::IosLayoutSnapshot;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

pub const COLUMNS: usize = 4;
pub const ROWS: usize = 6;
pub const SLOTS: usize = COLUMNS * ROWS;
pub const MAX_PAGE_FLIPS: usize = 3;
pub const MAX_PLAN_OPERATIONS: usize = 48;

pub fn slot_of(row: usize, column: usize) -> Option<usize> {
    (row < ROWS && column < COLUMNS).then_some(row * COLUMNS + column)
}

pub fn row_column(slot: usize) -> (usize, usize) {
    (slot / COLUMNS, slot % COLUMNS)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Occupant {
    App(String),
    Folder(usize),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PageMode {
    Packed,
    Free,
}

#[derive(Clone, Debug)]
pub struct PageModel {
    slots: Vec<Option<Occupant>>,
}

impl PageModel {
    pub fn count(&self) -> usize {
        self.slots.iter().filter(|slot| slot.is_some()).count()
    }

    pub fn mode(&self) -> PageMode {
        if self.slots[..self.count()].iter().all(Option::is_some) {
            PageMode::Packed
        } else {
            PageMode::Free
        }
    }

    pub fn occupant(&self, slot: usize) -> Option<&Occupant> {
        self.slots.get(slot).and_then(Option::as_ref)
    }

    pub fn last_occupied(&self) -> Option<usize> {
        self.slots.iter().rposition(Option::is_some)
    }

    pub fn first_empty(&self) -> Option<usize> {
        self.slots.iter().position(Option::is_none)
    }

    /// The only empty slot a cross-page arrival may use.
    pub fn arrival_slot(&self) -> Option<usize> {
        match self.mode() {
            PageMode::Packed => (self.count() < SLOTS).then(|| self.count()),
            PageMode::Free => self.first_empty(),
        }
    }

    pub fn app_at(&self, slot: usize) -> Option<&str> {
        match self.occupant(slot) {
            Some(Occupant::App(id)) => Some(id.as_str()),
            _ => None,
        }
    }

    pub fn apps(&self) -> impl Iterator<Item = (usize, &str)> {
        (0..SLOTS).filter_map(|slot| self.app_at(slot).map(|id| (slot, id)))
    }
}

#[derive(Clone, Debug)]
pub struct LayoutState {
    pages: BTreeMap<usize, PageModel>,
    known_pages: BTreeSet<usize>,
    touched: BTreeSet<usize>,
}

fn reliable_page(snapshot: &IosLayoutSnapshot, index: usize) -> Option<PageModel> {
    let entries = snapshot.pages.iter().filter(|page| page.index == index);
    let entries = entries.collect::<Vec<_>>();
    if entries.len() != 1 || entries[0].has_widgets {
        return None;
    }
    let folder_members = snapshot
        .folders
        .iter()
        .flat_map(|folder| folder.app_ids.iter().map(String::as_str))
        .collect::<HashSet<_>>();
    let mut id_counts = HashMap::<&str, usize>::new();
    for app in &snapshot.apps {
        *id_counts.entry(app.id.as_str()).or_default() += 1;
    }
    let mut slots = vec![None; SLOTS];
    let mut located = HashSet::new();
    for app in snapshot.apps.iter().filter(|app| {
        app.current_page == Some(index)
            && !app.in_dock
            && app.folder_name.is_none()
            && !folder_members.contains(app.id.as_str())
            && !snapshot.dock.contains(&app.id)
    }) {
        let slot = slot_of(app.current_row?, app.current_column?)?;
        if id_counts[app.id.as_str()] != 1 || app.id.trim().is_empty() || slots[slot].is_some() {
            return None;
        }
        slots[slot] = Some(Occupant::App(app.id.clone()));
        located.insert(app.id.as_str());
    }
    for (folder_index, folder) in snapshot.folders.iter().enumerate() {
        if folder.page != index {
            continue;
        }
        let slot = slot_of(folder.row, folder.column)?;
        if slots[slot].is_some() {
            return None;
        }
        slots[slot] = Some(Occupant::Folder(folder_index));
    }
    // Every page member must be a known identity: either a uniquely located
    // icon on this page, or an App inside a folder or the Dock.
    if entries[0].app_ids.iter().any(|id| {
        let contained = snapshot
            .apps
            .iter()
            .any(|app| app.id == *id && (app.in_dock || app.folder_name.is_some()))
            || folder_members.contains(id.as_str())
            || snapshot.dock.contains(id);
        !located.contains(id.as_str()) && !contained
    }) {
        return None;
    }
    Some(PageModel { slots })
}

impl LayoutState {
    pub fn from_snapshot(snapshot: &IosLayoutSnapshot) -> Self {
        let known_pages = snapshot.pages.iter().map(|page| page.index).collect();
        let pages = snapshot
            .pages
            .iter()
            .filter_map(|page| reliable_page(snapshot, page.index).map(|model| (page.index, model)))
            .collect();
        Self {
            pages,
            known_pages,
            touched: BTreeSet::new(),
        }
    }

    pub fn page(&self, index: usize) -> Option<&PageModel> {
        self.pages.get(&index)
    }

    pub fn page_indices(&self) -> Vec<usize> {
        self.pages.keys().copied().collect()
    }

    pub fn position_of(&self, app_id: &str) -> Option<(usize, usize)> {
        self.pages.iter().find_map(|(index, page)| {
            page.apps()
                .find(|(_, id)| *id == app_id)
                .map(|(slot, _)| (*index, slot))
        })
    }

    /// Apply one drag to the model, rejecting anything whose physical result
    /// would be ambiguous or would shift a locked icon.
    pub fn apply_move(
        &mut self,
        app_id: &str,
        from: (usize, usize),
        to: (usize, usize),
        locked: &dyn Fn(&str) -> bool,
    ) -> Result<(), String> {
        if from == to {
            return Err("Only non-empty moves can be automated".to_string());
        }
        if locked(app_id) {
            return Err(format!("Protected App cannot be moved: {app_id}"));
        }
        let source = self
            .pages
            .get(&from.0)
            .ok_or("Source page is missing, ambiguous or contains widgets")?;
        if source.app_at(from.1) != Some(app_id) {
            return Err("Plan source position no longer matches App".to_string());
        }
        if from.0 == to.0 {
            return self.apply_same_page(from.0, from.1, to.1, locked);
        }
        self.apply_cross_page(from, to)
    }

    fn apply_same_page(
        &mut self,
        index: usize,
        from: usize,
        to: usize,
        locked: &dyn Fn(&str) -> bool,
    ) -> Result<(), String> {
        let page = self.pages.get_mut(&index).expect("page checked");
        if to >= SLOTS {
            return Err("Home Screen coordinates are outside the safe grid".to_string());
        }
        match page.mode() {
            PageMode::Packed => {
                if to >= page.count() {
                    return Err(
                        "A packed page only allows reordering inside its occupied slots"
                            .to_string(),
                    );
                }
                let shifted = if to < from {
                    to..from
                } else {
                    from + 1..to + 1
                };
                for slot in shifted.clone() {
                    match page.occupant(slot) {
                        Some(Occupant::App(id)) if !locked(id) => {}
                        _ => return Err("Reflow would shift a protected App or folder".to_string()),
                    }
                }
                let moving = page.slots.remove(from);
                page.slots.insert(to, moving);
            }
            PageMode::Free => {
                if page.occupant(to).is_some() {
                    return Err("Move target is already occupied".to_string());
                }
                page.slots.swap(from, to);
            }
        }
        self.touched.insert(index);
        Ok(())
    }

    fn apply_cross_page(&mut self, from: (usize, usize), to: (usize, usize)) -> Result<(), String> {
        let flips = from.0.abs_diff(to.0);
        if flips > MAX_PAGE_FLIPS {
            return Err(format!(
                "Cross-page moves are limited to {MAX_PAGE_FLIPS} page flips"
            ));
        }
        let (low, high) = (from.0.min(to.0), from.0.max(to.0));
        if (low..=high).any(|index| !self.known_pages.contains(&index)) {
            return Err("Cross-page move passes an unknown page".to_string());
        }
        if self.pages[&from.0].last_occupied() != Some(from.1) {
            return Err("Only the last icon on a page can move to another page".to_string());
        }
        let target = self
            .pages
            .get(&to.0)
            .ok_or("Target page is missing, ambiguous or contains widgets")?;
        if to.1 >= SLOTS || target.occupant(to.1).is_some() {
            return Err("Move target is already occupied".to_string());
        }
        if target.mode() == PageMode::Packed && to.1 != target.count() {
            return Err("Cross-page arrivals on a packed page must append".to_string());
        }
        let moving = self.pages.get_mut(&from.0).expect("page checked").slots[from.1].take();
        self.pages.get_mut(&to.0).expect("page checked").slots[to.1] = moving;
        self.touched.insert(from.0);
        self.touched.insert(to.0);
        Ok(())
    }

    /// Rewrite App coordinates and page membership for every touched page.
    pub fn write_back(&self, snapshot: &mut IosLayoutSnapshot) {
        for index in &self.touched {
            let page = &self.pages[index];
            for (slot, id) in page.apps() {
                let (row, column) = row_column(slot);
                if let Some(app) = snapshot.apps.iter_mut().find(|app| app.id == id) {
                    app.current_page = Some(*index);
                    app.current_row = Some(row);
                    app.current_column = Some(column);
                }
            }
            if let Some(entry) = snapshot.pages.iter_mut().find(|item| item.index == *index) {
                entry.app_ids = page.apps().map(|(_, id)| id.to_string()).collect();
            }
        }
    }
}

#[cfg(test)]
#[path = "layout_model_tests.rs"]
mod tests;
