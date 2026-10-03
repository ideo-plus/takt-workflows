use reservation_domain::{MemberId, Reservation, ReservationId, ReservationStatus, RoomId};
use reservation_interface_adapter::InMemoryReservationRepository;
use reservation_use_case::{cancel_reservation, CancelReservationError, ReservationRepository};

fn confirmed_reservation(reservation_id: u64) -> Reservation {
    let mut reservation = Reservation::create(
        ReservationId::of(reservation_id),
        MemberId::of(101),
        RoomId::of(201),
        1_700_000_000,
        1_700_003_600,
    )
    .expect("the fixture end must be after its start");
    reservation
        .reserve_room()
        .expect("the fixture can be confirmed");
    reservation
}

#[test]
fn in_memory_repository_loads_a_saved_reservation_by_id() {
    let reservation_id = ReservationId::of(1);
    let mut repository = InMemoryReservationRepository::new();
    let expected = confirmed_reservation(1);

    repository
        .store(expected.clone())
        .expect("the in-memory repository must save a reservation");
    let loaded = repository
        .find_by_id(&reservation_id)
        .expect("the in-memory repository lookup must succeed")
        .expect("the saved reservation must exist");

    assert_eq!(loaded.id(), &reservation_id);
    assert_eq!(loaded.member_id(), expected.member_id());
    assert_eq!(loaded.room_id(), expected.room_id());
    assert_eq!(loaded.time_slot(), expected.time_slot());
    assert_eq!(loaded.status(), expected.status());
    assert!(loaded.is_confirmed());
}

#[test]
fn cancelling_a_reservation_persists_its_cancelled_state() {
    let reservation_id = ReservationId::of(1);
    let mut repository = InMemoryReservationRepository::new();
    repository
        .store(confirmed_reservation(1))
        .expect("the fixture reservation must be saved");
    let before_cancellation = repository
        .find_by_id(&reservation_id)
        .expect("the in-memory repository lookup must succeed")
        .expect("the confirmed reservation must exist");

    assert!(before_cancellation.is_confirmed());

    let cancelled = cancel_reservation(&mut repository, &reservation_id)
        .expect("an existing confirmed reservation can be cancelled");
    let loaded = repository
        .find_by_id(&reservation_id)
        .expect("the in-memory repository lookup must succeed")
        .expect("the cancelled reservation must still exist");

    assert_eq!(cancelled.reservation_id(), &reservation_id);
    assert_eq!(loaded.id(), before_cancellation.id());
    assert_eq!(loaded.member_id(), before_cancellation.member_id());
    assert_eq!(loaded.room_id(), before_cancellation.room_id());
    assert_eq!(loaded.time_slot(), before_cancellation.time_slot());
    assert!(loaded.is_cancelled());
}

#[test]
fn cancelling_the_same_reservation_twice_fails() {
    let reservation_id = ReservationId::of(1);
    let mut repository = InMemoryReservationRepository::new();
    repository
        .store(confirmed_reservation(1))
        .expect("the fixture reservation must be saved");
    cancel_reservation(&mut repository, &reservation_id)
        .expect("the first cancellation must succeed");

    let second_cancellation = cancel_reservation(&mut repository, &reservation_id);
    let loaded = repository
        .find_by_id(&reservation_id)
        .expect("the in-memory repository lookup must succeed")
        .expect("the cancelled reservation must still exist");

    assert!(matches!(
        second_cancellation,
        Err(CancelReservationError::AlreadyCancelled)
    ));
    assert!(loaded.is_cancelled());
}

#[test]
fn cancelling_an_unknown_id_fails_without_changing_existing_reservations() {
    let existing_id = ReservationId::of(1);
    let missing_id = ReservationId::of(2);
    let mut repository = InMemoryReservationRepository::new();
    repository
        .store(confirmed_reservation(1))
        .expect("the fixture reservation must be saved");
    let before_cancellation = repository
        .find_by_id(&existing_id)
        .expect("the in-memory repository lookup must succeed")
        .expect("the existing reservation must exist");

    assert!(before_cancellation.is_confirmed());

    let result = cancel_reservation(&mut repository, &missing_id);
    let existing = repository
        .find_by_id(&existing_id)
        .expect("the in-memory repository lookup must succeed")
        .expect("the unrelated reservation must still exist");

    assert!(matches!(result, Err(CancelReservationError::NotFound)));
    assert!(existing.is_confirmed());
}

#[test]
fn cancelling_an_uncreated_reservation_preserves_its_saved_attributes() {
    let id = ReservationId::of(3);
    let expected = Reservation::create(id.clone(), MemberId::of(103), RoomId::of(203), 100, 200)
        .expect("valid time slot");
    let mut repository = InMemoryReservationRepository::new();
    repository
        .store(expected.clone())
        .expect("fixture can be saved");
    let before = repository
        .find_by_id(&id)
        .expect("lookup succeeds")
        .expect("reservation exists");
    assert_eq!(before.status(), ReservationStatus::Uncreated);

    assert_eq!(
        cancel_reservation(&mut repository, &id),
        Err(CancelReservationError::NotConfirmed),
    );
    let loaded = repository
        .find_by_id(&id)
        .expect("lookup succeeds")
        .expect("reservation remains");
    assert_eq!(loaded.id(), expected.id());
    assert_eq!(loaded.member_id(), expected.member_id());
    assert_eq!(loaded.room_id(), expected.room_id());
    assert_eq!(loaded.time_slot(), expected.time_slot());
    assert_eq!(loaded.status(), ReservationStatus::Uncreated);
}

#[test]
fn store_upserts_all_attributes_and_restores_each_reservation_state() {
    let id = ReservationId::of(7);
    let mut repository = InMemoryReservationRepository::new();
    for status in [
        ReservationStatus::Uncreated,
        ReservationStatus::Confirmed,
        ReservationStatus::Cancelled,
    ] {
        let reservation = Reservation::restore(
            id.clone(),
            MemberId::of(107),
            RoomId::of(207),
            reservation_domain::TimeSlot::new(100, 200).expect("valid time slot"),
            status,
        );
        repository.store(reservation).expect("store succeeds");
        let mut loaded = repository
            .find_by_id(&id)
            .expect("lookup succeeds")
            .expect("stored reservation exists");
        assert_eq!(loaded.id(), &id);
        assert_eq!(loaded.member_id(), &MemberId::of(107));
        assert_eq!(loaded.room_id(), &RoomId::of(207));
        assert_eq!(loaded.time_slot().start(), 100);
        assert_eq!(loaded.time_slot().end(), 200);
        assert_eq!(loaded.status(), status);
        match status {
            ReservationStatus::Uncreated => {
                loaded
                    .reserve_room()
                    .expect("restored preparation can be confirmed");
            }
            ReservationStatus::Confirmed => {
                loaded
                    .cancel()
                    .expect("restored confirmation can be cancelled");
            }
            ReservationStatus::Cancelled => assert_eq!(
                loaded.cancel(),
                Err(reservation_domain::ReservationError::AlreadyCancelled)
            ),
        }
    }
}
