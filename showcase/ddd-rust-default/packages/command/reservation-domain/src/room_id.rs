#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseRoomIdError {
    NotPositive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomId(u64);

impl RoomId {
    pub fn of(value: u64) -> Self {
        Self::parse(value).expect("RoomIdは1以上の整数である必要があります")
    }

    /// 非整数入力は型検査で拒否する。
    /// ```compile_fail
    /// use reservation_domain::room_id::RoomId;
    /// let _ = RoomId::parse(1.5);
    /// ```
    pub fn parse(value: u64) -> Result<Self, ParseRoomIdError> {
        if value < 1 {
            return Err(ParseRoomIdError::NotPositive);
        }
        Ok(Self(value))
    }

    pub fn value(&self) -> u64 {
        self.0
    }
}

#[cfg(test)]
mod tests;
