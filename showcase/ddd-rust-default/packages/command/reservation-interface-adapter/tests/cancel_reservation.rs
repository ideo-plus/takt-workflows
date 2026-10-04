use std::time::{Duration, UNIX_EPOCH};

use reservation_domain::member_id::MemberId;
use reservation_domain::reservation::reservation_id::ReservationId;
use reservation_domain::reservation::{
    CancelReservationError, Reservation, ReservationEvent, ReservationStatus,
};
use reservation_domain::room_id::RoomId;
use reservation_interface_adapter::in_memory_reservation_repository::InMemoryReservationRepository;
use reservation_use_case::cancel_reservation::{
    CancelReservationFailure, CancelReservationUseCase, ReservationNotFound,
};
use reservation_use_case::reservation_repository::ReservationRepository;

fn confirmed_reservation(id: u64) -> Reservation {
    let start = UNIX_EPOCH + Duration::from_secs(3_600);
    Reservation::reserve(
        ReservationId::of(id),
        MemberId::of(10),
        RoomId::of(20),
        start,
        start + Duration::from_secs(1_800),
    )
    .expect("the reservation should be valid")
}

fn store_new(repository: &mut InMemoryReservationRepository, reservation: Reservation) {
    repository
        .store(
            reservation.id(),
            ReservationEvent::Reserved(reservation.reserved_event()),
        )
        .expect("the reservation should be stored");
}

#[test]
fn cancelling_a_stored_reservation_persists_the_cancelled_state() {
    let reservation_id = ReservationId::of(1);
    let mut repository = InMemoryReservationRepository::new();
    store_new(&mut repository, confirmed_reservation(1));

    let event = {
        let mut use_case = CancelReservationUseCase::new(&mut repository);
        use_case
            .execute(&reservation_id)
            .expect("the cancellation should succeed")
    };
    let stored = repository
        .find_by_id(&reservation_id)
        .expect("the repository load should succeed")
        .expect("the reservation should exist");

    assert_eq!(event.reservation_id(), &reservation_id);
    assert_eq!(stored.status(), ReservationStatus::Cancelled);
}

#[test]
fn cancelling_the_same_stored_reservation_twice_fails() {
    let reservation_id = ReservationId::of(1);
    let mut repository = InMemoryReservationRepository::new();
    store_new(&mut repository, confirmed_reservation(1));

    {
        let mut use_case = CancelReservationUseCase::new(&mut repository);
        use_case
            .execute(&reservation_id)
            .expect("the initial cancellation should succeed");
    }
    let failure = {
        let mut use_case = CancelReservationUseCase::new(&mut repository);
        use_case
            .execute(&reservation_id)
            .expect_err("the repeated cancellation should fail")
    };

    assert_eq!(
        failure,
        CancelReservationFailure::Rejected(CancelReservationError::AlreadyCancelled)
    );
    let stored = repository
        .find_by_id(&reservation_id)
        .expect("the repository load should succeed")
        .expect("the reservation should exist");
    assert_eq!(stored.status(), ReservationStatus::Cancelled);
}

#[test]
fn cancelling_a_missing_reservation_fails() {
    let reservation_id = ReservationId::of(404);
    let existing_id = ReservationId::of(1);
    let mut repository = InMemoryReservationRepository::new();
    store_new(&mut repository, confirmed_reservation(1));
    let before = repository
        .find_by_id(&existing_id)
        .expect("the repository load should succeed")
        .expect("the existing reservation should exist");

    let failure = {
        let mut use_case = CancelReservationUseCase::new(&mut repository);
        use_case
            .execute(&reservation_id)
            .expect_err("a missing reservation should fail")
    };

    assert_eq!(
        failure,
        CancelReservationFailure::NotFound(ReservationNotFound)
    );
    assert!(repository
        .find_by_id(&reservation_id)
        .expect("the repository load should succeed")
        .is_none());
    let after = repository
        .find_by_id(&existing_id)
        .expect("the repository load should succeed")
        .expect("the existing reservation should still exist");
    assert_eq!(after.status(), ReservationStatus::Confirmed);
    assert_eq!(after, before);
}

#[test]
fn cancelling_by_id_leaves_other_reservations_confirmed() {
    let target_id = ReservationId::of(1);
    let other_id = ReservationId::of(2);
    let mut repository = InMemoryReservationRepository::new();
    store_new(&mut repository, confirmed_reservation(1));
    store_new(&mut repository, confirmed_reservation(2));

    {
        let mut use_case = CancelReservationUseCase::new(&mut repository);
        use_case
            .execute(&target_id)
            .expect("the target reservation should be cancelled");
    }
    let other = repository
        .find_by_id(&other_id)
        .expect("the repository load should succeed")
        .expect("the other reservation should exist");

    assert_eq!(other.status(), ReservationStatus::Confirmed);
}
