use reservation_domain::reservation::reservation_id::ReservationId;
use reservation_domain::reservation::{Reservation, ReservationEvent};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryError {
    pub message: String,
}

impl RepositoryError {
    pub fn new(message: &str) -> Self {
        Self {
            message: message.to_owned(),
        }
    }
}

pub trait ReservationRepository {
    fn find_by_id(
        &self,
        reservation_id: &ReservationId,
    ) -> Result<Option<Reservation>, RepositoryError>;
    fn store(
        &mut self,
        event: ReservationEvent,
        snapshot: Reservation,
    ) -> Result<(), RepositoryError>;
}
