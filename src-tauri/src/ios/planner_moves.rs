//! Turn category goals into drags that the shared grid model accepts.
//! Every candidate is applied to `LayoutState` first, so the emitted
//! sequence is exactly what the safety gate will replay.
use super::super::layout_model::{
    row_column, LayoutState, Occupant, PageMode, MAX_PAGE_FLIPS, MAX_PLAN_OPERATIONS,
};
use super::super::types::{IosLayoutSnapshot, IosOperation};
use std::collections::{HashMap, HashSet};

pub(super) struct MovePlanner<'a> {
    state: LayoutState,
    locked: &'a dyn Fn(&str) -> bool,
    pub operations: Vec<IosOperation>,
    visible: Option<usize>,
    pub truncated: bool,
}

impl<'a> MovePlanner<'a> {
    pub fn new(snapshot: &IosLayoutSnapshot, locked: &'a dyn Fn(&str) -> bool) -> Self {
        Self {
            state: LayoutState::from_snapshot(snapshot),
            locked,
            operations: Vec::new(),
            visible: None,
            truncated: false,
        }
    }

    pub fn has_page(&self, page: usize) -> bool {
        self.state.page(page).is_some()
    }

    pub fn position_of(&self, app_id: &str) -> Option<(usize, usize)> {
        self.state.position_of(app_id)
    }

    /// Apply one drag to the model and record it; false if it is not safe.
    pub fn push(&mut self, app_id: &str, from: (usize, usize), to: (usize, usize)) -> bool {
        if self.operations.len() >= MAX_PLAN_OPERATIONS {
            self.truncated = true;
            return false;
        }
        if self
            .state
            .apply_move(app_id, from, to, self.locked)
            .is_err()
        {
            return false;
        }
        let (from_row, from_column) = row_column(from.1);
        let (to_row, to_column) = row_column(to.1);
        self.operations.push(IosOperation::MoveApp {
            app_id: app_id.to_string(),
            from_page: from.0,
            from_row,
            from_column,
            to_page: to.0,
            to_row,
            to_column,
        });
        self.visible = Some(to.0);
        true
    }

    /// Pages ordered so the next action starts where the last one ended,
    /// which avoids asking the user to switch pages between actions.
    fn ordered_pages(&self, mut pages: Vec<usize>) -> Vec<usize> {
        pages.sort_unstable();
        if let Some(index) = self
            .visible
            .and_then(|page| pages.iter().position(|p| *p == page))
        {
            let page = pages.remove(index);
            pages.insert(0, page);
        }
        pages
    }

    fn leavers(
        &self,
        page: usize,
        desired: &HashMap<String, usize>,
        blocked: &HashSet<String>,
    ) -> Vec<(usize, String, usize)> {
        let Some(model) = self.state.page(page) else {
            return Vec::new();
        };
        model
            .apps()
            .filter(|(_, id)| !(self.locked)(id) && !blocked.contains(*id))
            .filter_map(|(slot, id)| {
                let target = *desired.get(id)?;
                let reachable = target != page
                    && target.abs_diff(page) <= MAX_PAGE_FLIPS
                    && self.state.page(target)?.arrival_slot().is_some();
                reachable.then(|| (slot, id.to_string(), target))
            })
            .collect()
    }

    /// Move Apps to their template page. Only the last icon on a page can
    /// leave, so a packed page first reorders a leaver into its last slot.
    pub fn relocate(&mut self, desired: &HashMap<String, usize>) {
        let mut blocked = HashSet::new();
        while !self.truncated {
            let pages = self
                .state
                .page_indices()
                .into_iter()
                .filter(|page| !self.leavers(*page, desired, &blocked).is_empty())
                .collect::<Vec<_>>();
            let Some(page) = self.ordered_pages(pages).first().copied() else {
                break;
            };
            self.relocate_step(page, desired, &mut blocked);
        }
    }

    fn relocate_step(
        &mut self,
        page: usize,
        desired: &HashMap<String, usize>,
        blocked: &mut HashSet<String>,
    ) {
        let leavers = self.leavers(page, desired, blocked);
        let model = self.state.page(page).expect("page has leavers");
        let last = model.last_occupied().expect("page has leavers");
        let mode = model.mode();
        let last_app = model.app_at(last).map(str::to_string);
        let first_empty = model.first_empty().filter(|slot| *slot < last);
        if let Some((slot, id, target)) = leavers.iter().find(|(slot, ..)| *slot == last) {
            let arrival = self
                .state
                .page(*target)
                .and_then(|item| item.arrival_slot());
            let moved = arrival.is_some_and(|to| self.push(id, (page, *slot), (*target, to)));
            if !moved && !self.truncated {
                blocked.insert(id.clone());
            }
            return;
        }
        let progressed = match mode {
            PageMode::Packed => {
                let (slot, id, _) = leavers.last().expect("page has leavers").clone();
                let moved = self.push(&id, (page, slot), (page, last));
                if !moved && !self.truncated {
                    blocked.insert(id);
                }
                true
            }
            // On a free page, fill an earlier hole with the last icon so a
            // leaver can become the last icon later.
            PageMode::Free => match (last_app, first_empty) {
                (Some(id), Some(hole)) => self.push(&id, (page, last), (page, hole)),
                _ => false,
            },
        };
        if !progressed && !self.truncated {
            blocked.extend(leavers.into_iter().map(|(_, id, _)| id));
        }
    }

    /// Close holes, then sort every packed segment between locked icons.
    pub fn reorder(&mut self, rank: &dyn Fn(&str) -> (usize, String)) {
        for page in self.ordered_pages(self.state.page_indices()) {
            self.compact(page, rank);
            self.sort_segments(page, rank);
        }
    }

    /// Fill each hole with the best-ranked movable App after it. On a page
    /// with gaps any empty slot is a valid target, so this sorts while it
    /// closes holes; the page then becomes packed for segment sorting.
    fn compact(&mut self, page: usize, rank: &dyn Fn(&str) -> (usize, String)) {
        while !self.truncated {
            let model = self.state.page(page).expect("modelled page");
            let (Some(hole), Some(last)) = (model.first_empty(), model.last_occupied()) else {
                return;
            };
            let best = model
                .apps()
                .filter(|(slot, id)| *slot > hole && !(self.locked)(id))
                .min_by_key(|(_, id)| rank(id))
                .map(|(slot, id)| (slot, id.to_string()));
            let Some((slot, id)) = best else {
                return;
            };
            if hole > last || !self.push(&id, (page, slot), (page, hole)) {
                return;
            }
        }
    }

    fn sort_segments(&mut self, page: usize, rank: &dyn Fn(&str) -> (usize, String)) {
        let model = self.state.page(page).expect("modelled page");
        if model.mode() != PageMode::Packed {
            return;
        }
        let mut segments = vec![Vec::new()];
        for slot in 0..model.count() {
            match model.occupant(slot) {
                Some(Occupant::App(id)) if !(self.locked)(id) => segments
                    .last_mut()
                    .expect("segment")
                    .push((slot, id.clone())),
                _ => segments.push(Vec::new()),
            }
        }
        for segment in segments.into_iter().filter(|segment| segment.len() > 1) {
            let start = segment[0].0;
            let mut wanted = segment.into_iter().map(|(_, id)| id).collect::<Vec<_>>();
            wanted.sort_by_key(|id| rank(id));
            for (offset, id) in wanted.iter().enumerate() {
                let Some((_, current)) = self.state.position_of(id) else {
                    return;
                };
                if current != start + offset
                    && !self.push(id, (page, current), (page, start + offset))
                {
                    return;
                }
            }
        }
    }
}
