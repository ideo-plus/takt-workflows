use super::organization::Organization;
use super::user::User;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssessAccessEligibilityError {
    OrganizationInactive,
    OrganizationMismatch,
    UserUnavailable,
}

pub struct AccessEligibility;

impl AccessEligibility {
    pub fn create() -> Self {
        Self
    }

    pub fn assess(
        &self,
        organization: &Organization,
        user: &User,
    ) -> Result<bool, AssessAccessEligibilityError> {
        if !organization.is_active() {
            return Err(AssessAccessEligibilityError::OrganizationInactive);
        }
        if !user.belongs_to(organization) {
            return Err(AssessAccessEligibilityError::OrganizationMismatch);
        }
        if !user.is_available() {
            return Err(AssessAccessEligibilityError::UserUnavailable);
        }
        Ok(true)
    }
}
