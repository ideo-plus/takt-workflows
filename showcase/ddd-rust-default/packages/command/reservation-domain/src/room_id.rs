#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RoomId(u64);

impl RoomId {
    pub fn of(value: u64) -> Self {
        Self(value)
    }
}
