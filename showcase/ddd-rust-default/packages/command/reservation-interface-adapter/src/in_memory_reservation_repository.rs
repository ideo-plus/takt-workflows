use reservation_domain::reservation::reservation_id::ReservationId;
use reservation_domain::reservation::{Reservation, ReservationEvent};
use reservation_use_case::reservation_repository::{RepositoryError, ReservationRepository};
use std::collections::HashMap;

pub struct InMemoryReservationRepository {
    events: HashMap<ReservationId, Vec<ReservationEvent>>,
}

impl InMemoryReservationRepository {
    pub fn new() -> Self {
        Self {
            events: HashMap::new(),
        }
    }

    pub fn events_for(&self, id: &ReservationId) -> &[ReservationEvent] {
        self.events.get(id).map(Vec::as_slice).unwrap_or(&[])
    }
}

impl ReservationRepository for InMemoryReservationRepository {
    fn find_by_id(&self, id: &ReservationId) -> Result<Option<Reservation>, RepositoryError> {
        let Some(events) = self.events.get(id) else {
            return Ok(None);
        };
        Reservation::restore(id, events)
            .map(Some)
            .map_err(|_| RepositoryError::new("予約のイベント履歴が不正です"))
    }

    fn store(
        &mut self,
        id: &ReservationId,
        event: ReservationEvent,
    ) -> Result<(), RepositoryError> {
        if event.reservation_id() != id {
            return Err(RepositoryError::new("予約IDがイベントと一致しません"));
        }
        let mut candidate = self.events.get(id).cloned().unwrap_or_default();
        candidate.push(event.clone());
        Reservation::restore(id, &candidate)
            .map_err(|_| RepositoryError::new("予約のイベント順序が不正です"))?;
        self.events.entry(id.clone()).or_default().push(event);
        Ok(())
    }
}

#[cfg(test)]
mod tests;
