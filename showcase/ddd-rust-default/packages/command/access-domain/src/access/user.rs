use super::organization::Organization;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateUserError {
    MissingId,
    MissingOrganizationId,
    MissingAvailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CorruptUserHistory;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserCreated {
    user_id: String,
    organization_id: String,
    available: bool,
    sequence_number: u64,
}

impl UserCreated {
    fn new(user_id: &str, organization_id: &str, available: bool) -> Self {
        Self {
            user_id: user_id.to_string(),
            organization_id: organization_id.to_string(),
            available,
            sequence_number: 1,
        }
    }
}

#[derive(Debug, Clone)]
pub struct User {
    creation: UserCreated,
}

impl User {
    fn new(creation: UserCreated) -> Self {
        Self { creation }
    }

    pub fn create(
        id: Option<&str>,
        organization_id: Option<&str>,
        available: Option<bool>,
    ) -> Result<Self, CreateUserError> {
        let id = id.ok_or(CreateUserError::MissingId)?;
        let organization_id = organization_id.ok_or(CreateUserError::MissingOrganizationId)?;
        let available = available.ok_or(CreateUserError::MissingAvailable)?;
        let event = UserCreated::new(id, organization_id, available);
        Ok(Self::from_created(&event))
    }

    pub fn from_created(event: &UserCreated) -> Self {
        Self::new(event.clone())
    }

    pub fn created_event(&self) -> UserCreated {
        self.creation.clone()
    }

    pub fn sequence_number(&self) -> u64 {
        self.creation.sequence_number
    }

    pub fn replay(events: &[UserCreated], snapshot: Self) -> Result<Self, CorruptUserHistory> {
        // 宣言されたイベントは生成だけなので、既存集約に有効な続きはない。
        if !events.is_empty() {
            return Err(CorruptUserHistory);
        }
        Ok(snapshot)
    }

    pub fn is_available(&self) -> bool {
        self.creation.available
    }

    pub fn is_identified_by(&self, identifier: &str) -> bool {
        self.creation.user_id == identifier
    }

    pub fn belongs_to(&self, organization: &Organization) -> bool {
        organization.is_identified_by(&self.creation.organization_id)
    }
}
