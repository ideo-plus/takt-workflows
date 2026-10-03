use reservation_domain::{ReservationCancelled, ReservationError, ReservationId};

use crate::{RepositoryError, ReservationRepository};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CancelReservationError {
    NotFound,
    AlreadyCancelled,
    NotConfirmed,
    Repository(RepositoryError),
}

pub fn cancel_reservation<R: ReservationRepository>(
    reservation_repository: &mut R,
    reservation_id: &ReservationId,
) -> Result<ReservationCancelled, CancelReservationError> {
    let mut reservation = reservation_repository
        .find_by_id(reservation_id)
        .map_err(CancelReservationError::Repository)?
        .ok_or(CancelReservationError::NotFound)?;
    let cancelled = reservation.cancel().map_err(|error| match error {
        ReservationError::AlreadyCancelled => CancelReservationError::AlreadyCancelled,
        ReservationError::NotConfirmed => CancelReservationError::NotConfirmed,
    })?;
    reservation_repository
        .store(reservation)
        .map_err(CancelReservationError::Repository)?;
    Ok(cancelled)
}
