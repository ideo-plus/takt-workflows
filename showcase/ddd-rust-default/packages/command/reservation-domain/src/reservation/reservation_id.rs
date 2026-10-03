#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ReservationId(u64);

impl ReservationId {
    pub fn of(value: u64) -> Self {
        Self(value)
    }
}
