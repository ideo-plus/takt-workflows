#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MemberId(u64);

impl MemberId {
    pub fn of(value: u64) -> Self {
        Self(value)
    }
}
