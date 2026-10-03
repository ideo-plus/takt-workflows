use super::ReservationId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationConfirmed {
    reservation_id: ReservationId,
}

impl ReservationConfirmed {
    pub(crate) fn new(reservation_id: ReservationId) -> Self {
        Self { reservation_id }
    }

    pub fn reservation_id(&self) -> &ReservationId {
        &self.reservation_id
    }
}
