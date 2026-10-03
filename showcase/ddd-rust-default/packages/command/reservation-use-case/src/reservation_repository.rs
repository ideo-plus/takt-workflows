use reservation_domain::{Reservation, ReservationId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryError {
    pub message: String,
}

pub trait ReservationRepository {
    fn store(&mut self, reservation: Reservation) -> Result<(), RepositoryError>;
    fn find_by_id(
        &self,
        reservation_id: &ReservationId,
    ) -> Result<Option<Reservation>, RepositoryError>;
}
