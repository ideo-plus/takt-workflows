pub mod reservation_id;
pub mod time_slot;

use crate::member_id::MemberId;
use crate::room_id::RoomId;
use reservation_id::ReservationId;
use std::time::SystemTime;
use time_slot::TimeSlot;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReservationStatus {
    Confirmed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReserveReservationError {
    InvalidTimeSlot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CorruptReservationHistory {
    MissingReservationEvent,
    WrongReservation,
    InvalidTransition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelReservationError {
    AlreadyCancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationReserved {
    reservation_id: ReservationId,
    member_id: MemberId,
    room_id: RoomId,
    time_slot: TimeSlot,
}

impl ReservationReserved {
    fn new(
        reservation_id: ReservationId,
        member_id: MemberId,
        room_id: RoomId,
        time_slot: TimeSlot,
    ) -> Self {
        Self {
            reservation_id,
            member_id,
            room_id,
            time_slot,
        }
    }
    pub fn reservation_id(&self) -> &ReservationId {
        &self.reservation_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationCancelled {
    reservation_id: ReservationId,
}

impl ReservationCancelled {
    fn new(reservation_id: ReservationId) -> Self {
        Self { reservation_id }
    }
    pub fn reservation_id(&self) -> &ReservationId {
        &self.reservation_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReservationEvent {
    Reserved(ReservationReserved),
    Cancelled(ReservationCancelled),
}

impl ReservationEvent {
    pub fn reservation_id(&self) -> &ReservationId {
        match self {
            Self::Reserved(event) => event.reservation_id(),
            Self::Cancelled(event) => event.reservation_id(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reservation {
    id: ReservationId,
    member_id: MemberId,
    room_id: RoomId,
    time_slot: TimeSlot,
    status: ReservationStatus,
}

impl Reservation {
    fn new(
        id: ReservationId,
        member_id: MemberId,
        room_id: RoomId,
        time_slot: TimeSlot,
        status: ReservationStatus,
    ) -> Self {
        Self {
            id,
            member_id,
            room_id,
            time_slot,
            status,
        }
    }

    pub fn reserve(
        id: ReservationId,
        member_id: MemberId,
        room_id: RoomId,
        start: SystemTime,
        end: SystemTime,
    ) -> Result<Self, ReserveReservationError> {
        let time_slot =
            TimeSlot::create(start, end).map_err(|_| ReserveReservationError::InvalidTimeSlot)?;
        let event = ReservationReserved::new(id, member_id, room_id, time_slot);
        Ok(Self::from_reserved(&event))
    }

    pub fn reserved_event(&self) -> ReservationReserved {
        ReservationReserved::new(
            self.id.clone(),
            self.member_id.clone(),
            self.room_id.clone(),
            self.time_slot.clone(),
        )
    }

    pub fn restore(
        id: &ReservationId,
        events: &[ReservationEvent],
    ) -> Result<Self, CorruptReservationHistory> {
        let Some(ReservationEvent::Reserved(first)) = events.first() else {
            return Err(CorruptReservationHistory::MissingReservationEvent);
        };
        if first.reservation_id() != id {
            return Err(CorruptReservationHistory::WrongReservation);
        }
        let mut reservation = Self::from_reserved(first);
        for event in &events[1..] {
            if event.reservation_id() != id {
                return Err(CorruptReservationHistory::WrongReservation);
            }
            match event {
                ReservationEvent::Cancelled(cancelled)
                    if reservation.status == ReservationStatus::Confirmed =>
                {
                    reservation.apply_cancelled(cancelled);
                }
                _ => return Err(CorruptReservationHistory::InvalidTransition),
            }
        }
        Ok(reservation)
    }

    fn from_reserved(event: &ReservationReserved) -> Self {
        Self::new(
            event.reservation_id.clone(),
            event.member_id.clone(),
            event.room_id.clone(),
            event.time_slot.clone(),
            ReservationStatus::Confirmed,
        )
    }

    fn apply_cancelled(&mut self, _event: &ReservationCancelled) {
        self.status = ReservationStatus::Cancelled;
    }

    pub fn cancel(&mut self) -> Result<ReservationCancelled, CancelReservationError> {
        if self.status == ReservationStatus::Cancelled {
            return Err(CancelReservationError::AlreadyCancelled);
        }
        let event = ReservationCancelled::new(self.id.clone());
        self.apply_cancelled(&event);
        Ok(event)
    }

    pub fn id(&self) -> &ReservationId {
        &self.id
    }
    pub fn member_id(&self) -> &MemberId {
        &self.member_id
    }
    pub fn room_id(&self) -> &RoomId {
        &self.room_id
    }
    pub fn time_slot(&self) -> &TimeSlot {
        &self.time_slot
    }
    pub fn status(&self) -> ReservationStatus {
        self.status
    }
}

#[cfg(test)]
mod tests;
