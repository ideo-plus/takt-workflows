use reservation_domain::{MemberId, Reservation, ReservationId, RoomId};
use reservation_use_case::{
    cancel_reservation, CancelReservationError, RepositoryError, ReservationRepository,
};

struct TestRepository {
    lookup: Result<Option<Reservation>, RepositoryError>,
    store_result: Result<(), RepositoryError>,
    stored: Vec<Reservation>,
}

impl ReservationRepository for TestRepository {
    fn find_by_id(&self, id: &ReservationId) -> Result<Option<Reservation>, RepositoryError> {
        assert_eq!(id, &ReservationId::of(7));
        self.lookup.clone()
    }

    fn store(&mut self, reservation: Reservation) -> Result<(), RepositoryError> {
        self.stored.push(reservation);
        self.store_result.clone()
    }
}

fn confirmed_reservation() -> Reservation {
    let mut reservation = Reservation::create(
        ReservationId::of(7),
        MemberId::of(107),
        RoomId::of(207),
        100,
        200,
    )
    .expect("valid time slot");
    reservation
        .reserve_room()
        .expect("preparation can be confirmed");
    reservation
}

#[test]
fn read_failure_is_returned_without_attempting_to_store() {
    let error = RepositoryError {
        message: "read failed".into(),
    };
    let mut repository = TestRepository {
        lookup: Err(error.clone()),
        store_result: Ok(()),
        stored: Vec::new(),
    };
    assert_eq!(
        cancel_reservation(&mut repository, &ReservationId::of(7)),
        Err(CancelReservationError::Repository(error)),
    );
    assert!(repository.stored.is_empty());
}

#[test]
fn store_failure_returns_error_after_receiving_the_cancelled_reservation() {
    let error = RepositoryError {
        message: "store failed".into(),
    };
    let mut repository = TestRepository {
        lookup: Ok(Some(confirmed_reservation())),
        store_result: Err(error.clone()),
        stored: Vec::new(),
    };
    assert_eq!(
        cancel_reservation(&mut repository, &ReservationId::of(7)),
        Err(CancelReservationError::Repository(error)),
    );
    assert_eq!(repository.stored.len(), 1);
    let stored = &repository.stored[0];
    assert!(stored.is_cancelled());
    assert_eq!(stored.id(), &ReservationId::of(7));
    assert_eq!(stored.member_id(), &MemberId::of(107));
    assert_eq!(stored.room_id(), &RoomId::of(207));
    assert_eq!(stored.time_slot().start(), 100);
    assert_eq!(stored.time_slot().end(), 200);
}

#[test]
fn successful_store_returns_the_cancellation_event() {
    let mut repository = TestRepository {
        lookup: Ok(Some(confirmed_reservation())),
        store_result: Ok(()),
        stored: Vec::new(),
    };
    let event = cancel_reservation(&mut repository, &ReservationId::of(7))
        .expect("store success returns event");
    assert_eq!(event.reservation_id(), &ReservationId::of(7));
    assert_eq!(repository.stored.len(), 1);
    assert!(repository.stored[0].is_cancelled());
}

#[test]
fn successful_lookup_without_a_reservation_is_not_a_repository_failure() {
    let mut repository = TestRepository {
        lookup: Ok(None),
        store_result: Ok(()),
        stored: Vec::new(),
    };
    assert_eq!(
        cancel_reservation(&mut repository, &ReservationId::of(7)),
        Err(CancelReservationError::NotFound),
    );
    assert!(repository.stored.is_empty());
}
