use std::collections::HashMap;

use reservation_domain::{
    MemberId, Reservation, ReservationId, ReservationStatus, RoomId, TimeSlot,
};
use reservation_use_case::{RepositoryError, ReservationRepository};

pub struct InMemoryReservationRepository {
    reservations: HashMap<ReservationId, StoredReservation>,
}

struct StoredReservation {
    id: ReservationId,
    member_id: MemberId,
    room_id: RoomId,
    time_slot: TimeSlot,
    status: ReservationStatus,
}

impl InMemoryReservationRepository {
    pub fn new() -> Self {
        Self {
            reservations: HashMap::new(),
        }
    }
}

impl ReservationRepository for InMemoryReservationRepository {
    fn store(&mut self, reservation: Reservation) -> Result<(), RepositoryError> {
        let stored = StoredReservation {
            id: reservation.id().clone(),
            member_id: reservation.member_id().clone(),
            room_id: reservation.room_id().clone(),
            time_slot: reservation.time_slot().clone(),
            status: reservation.status(),
        };
        self.reservations.insert(stored.id.clone(), stored);
        Ok(())
    }

    fn find_by_id(
        &self,
        reservation_id: &ReservationId,
    ) -> Result<Option<Reservation>, RepositoryError> {
        Ok(self.reservations.get(reservation_id).map(|stored| {
            Reservation::restore(
                stored.id.clone(),
                stored.member_id.clone(),
                stored.room_id.clone(),
                stored.time_slot.clone(),
                stored.status,
            )
        }))
    }
}
