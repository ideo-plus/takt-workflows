use super::organization::Organization;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateUserError {
    InvalidInput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CorruptUserHistory {
    InvalidHistory,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserCreated {
    user_id: String,
    organization_id: String,
    available: bool,
    sequence_number: u64,
}

impl UserCreated {
    fn new(
        user_id: String,
        organization_id: String,
        available: bool,
        sequence_number: u64,
    ) -> Self {
        Self {
            user_id,
            organization_id,
            available,
            sequence_number,
        }
    }

    pub fn from_record(
        user_id: String,
        organization_id: String,
        available: bool,
        sequence_number: u64,
    ) -> Self {
        Self::new(user_id, organization_id, available, sequence_number)
    }

    pub fn user_id(&self) -> &str {
        &self.user_id
    }

    pub fn sequence_number(&self) -> u64 {
        self.sequence_number
    }
}

#[derive(Debug, Clone)]
pub struct User {
    created: UserCreated,
}

impl User {
    fn new(created: UserCreated) -> Self {
        Self { created }
    }

    pub fn create(
        id: Option<String>,
        organization_id: Option<String>,
        available: Option<bool>,
    ) -> Result<Self, CreateUserError> {
        let (Some(id), Some(organization_id), Some(available)) = (id, organization_id, available)
        else {
            return Err(CreateUserError::InvalidInput);
        };
        let event = UserCreated::new(id, organization_id, available, 1);
        Ok(Self::from_created(&event))
    }

    pub fn replay(events: &[UserCreated]) -> Result<Self, CorruptUserHistory> {
        if events.len() != 1 {
            return Err(CorruptUserHistory::InvalidHistory);
        }
        let event = &events[0];
        if event.sequence_number != 1 {
            return Err(CorruptUserHistory::InvalidHistory);
        }
        Ok(Self::from_created(event))
    }

    fn from_created(event: &UserCreated) -> Self {
        Self::new(event.clone())
    }

    pub fn created_event(&self) -> UserCreated {
        self.created.clone()
    }

    pub fn is_available(&self) -> bool {
        self.created.available == true
    }

    pub fn belongs_to(&self, organization: &Organization) -> bool {
        organization.is_identified_by(&self.created.organization_id)
    }
}

impl PartialEq for User {
    fn eq(&self, other: &Self) -> bool {
        self.created.user_id == other.created.user_id
    }
}

impl Eq for User {}
