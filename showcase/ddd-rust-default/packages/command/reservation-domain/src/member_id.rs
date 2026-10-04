#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseMemberIdError {
    NotPositive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberId(u64);

impl MemberId {
    fn new(value: u64) -> Self {
        Self(value)
    }

    pub fn of(value: u64) -> Self {
        Self::parse(value).expect("MemberIdは1以上の整数である必要があります")
    }

    /// 非整数入力は型検査で拒否する。
    /// ```compile_fail
    /// use reservation_domain::member_id::MemberId;
    /// let _ = MemberId::parse(1.5);
    /// ```
    pub fn parse(value: u64) -> Result<Self, ParseMemberIdError> {
        if value < 1 {
            return Err(ParseMemberIdError::NotPositive);
        }
        Ok(Self::new(value))
    }

    pub fn value(&self) -> u64 {
        self.0
    }
}

#[cfg(test)]
mod tests;
