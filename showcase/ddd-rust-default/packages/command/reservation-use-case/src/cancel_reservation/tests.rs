use super::{CancelReservationFailure, CancelReservationUseCase};
use crate::reservation_repository::{RepositoryError, ReservationRepository};
use reservation_domain::member_id::MemberId;
use reservation_domain::reservation::reservation_id::ReservationId;
use reservation_domain::reservation::{CancelReservationError, Reservation, ReservationEvent};
use reservation_domain::room_id::RoomId;
use std::time::{Duration, UNIX_EPOCH};

struct ControllableRepository {
    load_result: Result<Option<Reservation>, RepositoryError>,
    store_failure: Option<RepositoryError>,
    store_calls: usize,
}

impl ControllableRepository {
    fn loading(reservation: Reservation) -> Self {
        Self {
            load_result: Ok(Some(reservation)),
            store_failure: None,
            store_calls: 0,
        }
    }
    fn failing_to_load(error: RepositoryError) -> Self {
        Self {
            load_result: Err(error),
            store_failure: None,
            store_calls: 0,
        }
    }
}

impl ReservationRepository for ControllableRepository {
    fn find_by_id(&self, _id: &ReservationId) -> Result<Option<Reservation>, RepositoryError> {
        self.load_result.clone()
    }
    fn store(
        &mut self,
        _id: &ReservationId,
        _event: ReservationEvent,
    ) -> Result<(), RepositoryError> {
        self.store_calls += 1;
        match &self.store_failure {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }
}

fn confirmed_reservation() -> Reservation {
    let start = UNIX_EPOCH + Duration::from_secs(3_600);
    Reservation::reserve(
        ReservationId::of(1),
        MemberId::of(2),
        RoomId::of(3),
        start,
        start + Duration::from_secs(1_800),
    )
    .expect("the reservation should be valid")
}

#[test]
fn load_failure_is_returned_without_attempting_to_store() {
    let expected = RepositoryError::new("load failed");
    let mut repository = ControllableRepository::failing_to_load(expected.clone());

    let failure = {
        let mut use_case = CancelReservationUseCase::new(&mut repository);
        use_case
            .execute(&ReservationId::of(1))
            .expect_err("the load failure should be returned")
    };

    assert_eq!(failure, CancelReservationFailure::Repository(expected));
    assert_eq!(repository.store_calls, 0);
}

#[test]
fn store_failure_is_returned_instead_of_a_success_event() {
    let expected = RepositoryError::new("store failed");
    let mut repository = ControllableRepository::loading(confirmed_reservation());
    repository.store_failure = Some(expected.clone());

    let failure = {
        let mut use_case = CancelReservationUseCase::new(&mut repository);
        use_case
            .execute(&ReservationId::of(1))
            .expect_err("the store failure should be returned")
    };

    assert_eq!(failure, CancelReservationFailure::Repository(expected));
    assert_eq!(repository.store_calls, 1);
}

#[test]
fn rejected_cancellation_does_not_attempt_to_store() {
    let mut reservation = confirmed_reservation();
    reservation
        .cancel()
        .expect("the initial cancellation should succeed");
    let mut repository = ControllableRepository::loading(reservation);

    let failure = {
        let mut use_case = CancelReservationUseCase::new(&mut repository);
        use_case
            .execute(&ReservationId::of(1))
            .expect_err("a cancelled reservation should be rejected")
    };

    assert_eq!(
        failure,
        CancelReservationFailure::Rejected(CancelReservationError::AlreadyCancelled)
    );
    assert_eq!(repository.store_calls, 0);
}
