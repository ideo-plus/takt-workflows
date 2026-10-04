use reservation_domain::reservation::reservation_id::ReservationId;
use reservation_domain::reservation::{
    CancelReservationError, ReservationCancelled, ReservationEvent,
};

use crate::reservation_repository::{RepositoryError, ReservationRepository};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReservationNotFound;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CancelReservationFailure {
    NotFound(ReservationNotFound),
    Rejected(CancelReservationError),
    Repository(RepositoryError),
}

pub struct CancelReservationUseCase<'a, R: ReservationRepository> {
    reservation_repository: &'a mut R,
}

impl<'a, R: ReservationRepository> CancelReservationUseCase<'a, R> {
    pub fn new(reservation_repository: &'a mut R) -> Self {
        Self {
            reservation_repository,
        }
    }

    pub fn execute(
        &mut self,
        reservation_id: &ReservationId,
    ) -> Result<ReservationCancelled, CancelReservationFailure> {
        let mut reservation = self
            .reservation_repository
            .find_by_id(reservation_id)
            .map_err(CancelReservationFailure::Repository)?
            .ok_or(CancelReservationFailure::NotFound(ReservationNotFound))?;
        let event = reservation
            .cancel()
            .map_err(CancelReservationFailure::Rejected)?;
        self.reservation_repository
            .store(reservation_id, ReservationEvent::Cancelled(event.clone()))
            .map_err(CancelReservationFailure::Repository)?;
        Ok(event)
    }
}

#[cfg(test)]
mod tests;
