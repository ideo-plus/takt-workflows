use reservation_domain::reservation::reservation_id::ReservationId;
use reservation_domain::reservation::{Reservation, ReservationEvent};
use reservation_use_case::reservation_repository::{RepositoryError, ReservationRepository};
use std::collections::HashMap;

pub struct InMemoryReservationRepository {
    events: HashMap<ReservationId, Vec<ReservationEvent>>,
    snapshots: HashMap<ReservationId, Reservation>,
    snapshot_interval: u64,
}

impl InMemoryReservationRepository {
    pub fn new(snapshot_interval: u64) -> Self {
        assert!(snapshot_interval > 0, "スナップショットの間隔は1以上です");
        Self {
            events: HashMap::new(),
            snapshots: HashMap::new(),
            snapshot_interval,
        }
    }
}

impl ReservationRepository for InMemoryReservationRepository {
    fn find_by_id(&self, id: &ReservationId) -> Result<Option<Reservation>, RepositoryError> {
        let Some(snapshot) = self.snapshots.get(id) else {
            return Ok(None);
        };
        let events: Vec<ReservationEvent> = self
            .events
            .get(id)
            .into_iter()
            .flatten()
            .filter(|event| event.sequence_number() > snapshot.sequence_number())
            .cloned()
            .collect();
        Reservation::replay(&events, snapshot.clone())
            .map(Some)
            .map_err(|_| RepositoryError::new("予約のイベント履歴が不正です"))
    }

    fn store(
        &mut self,
        event: ReservationEvent,
        snapshot: Reservation,
    ) -> Result<(), RepositoryError> {
        if event.reservation_id() != snapshot.id()
            || event.sequence_number() != snapshot.sequence_number()
        {
            return Err(RepositoryError::new(
                "スナップショットがイベント直後の予約ではありません",
            ));
        }
        let last = self
            .events
            .get(event.reservation_id())
            .and_then(|stream| stream.last())
            .map_or(0, ReservationEvent::sequence_number);
        if event.sequence_number() != last + 1 {
            return Err(RepositoryError::new(
                "イベントが保存済みの履歴に続いていません",
            ));
        }
        let sequence_number = event.sequence_number();
        self.events
            .entry(event.reservation_id().clone())
            .or_default()
            .push(event);
        if sequence_number == 1 || sequence_number % self.snapshot_interval == 0 {
            self.snapshots.insert(snapshot.id().clone(), snapshot);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
