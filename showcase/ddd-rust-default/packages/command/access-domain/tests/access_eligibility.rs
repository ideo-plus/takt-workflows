use access_domain::access::eligibility::{AccessEligibility, AssessAccessEligibilityError};
use access_domain::access::organization::Organization;
use access_domain::access::user::User;

fn organization(id: &str, active: bool) -> Organization {
    Organization::create(Some(id), Some(active)).expect("利用組織を作成できる入力")
}

fn user(id: &str, organization_id: &str, available: bool) -> User {
    User::create(Some(id), Some(organization_id), Some(available)).expect("利用者を作成できる入力")
}

#[test]
fn active_organization_allows_an_available_member() {
    let organization = organization("org-a", true);
    let user = user("user-a", "org-a", true);
    let eligibility = AccessEligibility::create();

    let result = eligibility.assess(&organization, &user);

    assert_eq!(result, Ok(true));
}

#[test]
fn active_organization_rejects_an_unavailable_member() {
    let organization = organization("org-a", true);
    let user = user("user-a", "org-a", false);
    let eligibility = AccessEligibility::create();

    let result = eligibility.assess(&organization, &user);

    assert_eq!(result, Err(AssessAccessEligibilityError::UserUnavailable));
}

#[test]
fn active_organization_rejects_an_available_non_member() {
    let organization = organization("org-a", true);
    let user = user("user-a", "org-b", true);
    let eligibility = AccessEligibility::create();

    let result = eligibility.assess(&organization, &user);

    assert_eq!(
        result,
        Err(AssessAccessEligibilityError::OrganizationMismatch)
    );
}

#[test]
fn organization_mismatch_precedes_user_unavailability() {
    let organization = organization("org-a", true);
    let user = user("user-a", "org-b", false);
    let eligibility = AccessEligibility::create();

    let result = eligibility.assess(&organization, &user);

    assert_eq!(
        result,
        Err(AssessAccessEligibilityError::OrganizationMismatch)
    );
}

#[test]
fn inactive_organization_rejects_an_available_member() {
    let organization = organization("org-a", false);
    let user = user("user-a", "org-a", true);
    let eligibility = AccessEligibility::create();

    let result = eligibility.assess(&organization, &user);

    assert_eq!(
        result,
        Err(AssessAccessEligibilityError::OrganizationInactive)
    );
}

#[test]
fn organization_inactivity_precedes_user_unavailability() {
    let organization = organization("org-a", false);
    let user = user("user-a", "org-a", false);
    let eligibility = AccessEligibility::create();

    let result = eligibility.assess(&organization, &user);

    assert_eq!(
        result,
        Err(AssessAccessEligibilityError::OrganizationInactive)
    );
}

#[test]
fn organization_inactivity_precedes_organization_mismatch() {
    let organization = organization("org-a", false);
    let user = user("user-a", "org-b", true);
    let eligibility = AccessEligibility::create();

    let result = eligibility.assess(&organization, &user);

    assert_eq!(
        result,
        Err(AssessAccessEligibilityError::OrganizationInactive)
    );
}

#[test]
fn organization_inactivity_precedes_all_other_rejections() {
    let organization = organization("org-a", false);
    let user = user("user-a", "org-b", false);
    let eligibility = AccessEligibility::create();

    let result = eligibility.assess(&organization, &user);

    assert_eq!(
        result,
        Err(AssessAccessEligibilityError::OrganizationInactive)
    );
}

#[test]
fn matching_empty_identifiers_can_be_eligible() {
    let organization = organization("", true);
    let user = user("", "", true);
    let eligibility = AccessEligibility::create();

    let result = eligibility.assess(&organization, &user);

    assert_eq!(result, Ok(true));
}

#[test]
fn an_allowed_result_is_stable_across_an_unrelated_rejection() {
    let organization = organization("org-a", true);
    let original_user = user("user-a", "org-a", true);
    let unrelated_user = user("user-b", "org-b", true);
    let eligibility = AccessEligibility::create();

    let before = eligibility.assess(&organization, &original_user);
    let unrelated = eligibility.assess(&organization, &unrelated_user);
    let after = eligibility.assess(&organization, &original_user);

    assert_eq!(before, Ok(true));
    assert_eq!(
        unrelated,
        Err(AssessAccessEligibilityError::OrganizationMismatch)
    );
    assert_eq!(after, before);
}

#[test]
fn a_rejection_reason_is_stable_across_an_unrelated_allowance() {
    let organization = organization("org-a", true);
    let original_user = user("user-a", "org-b", false);
    let unrelated_user = user("user-b", "org-a", true);
    let eligibility = AccessEligibility::create();

    let before = eligibility.assess(&organization, &original_user);
    let unrelated = eligibility.assess(&organization, &unrelated_user);
    let after = eligibility.assess(&organization, &original_user);

    assert_eq!(
        before,
        Err(AssessAccessEligibilityError::OrganizationMismatch)
    );
    assert_eq!(unrelated, Ok(true));
    assert_eq!(after, before);
}

#[test]
fn allowance_does_not_change_inputs_or_creation_events() {
    let organization = organization("org-a", true);
    let user = user("user-a", "org-a", true);
    let organization_event = organization.created_event();
    let user_event = user.created_event();
    let organization_sequence = organization.sequence_number();
    let user_sequence = user.sequence_number();
    let eligibility = AccessEligibility::create();

    let result = eligibility.assess(&organization, &user);

    assert_eq!(result, Ok(true));
    assert!(organization.is_active());
    assert!(organization.is_identified_by("org-a"));
    assert!(user.is_available());
    assert!(user.is_identified_by("user-a"));
    assert!(user.belongs_to(&organization));
    assert_eq!(organization.created_event(), organization_event);
    assert_eq!(user.created_event(), user_event);
    assert_eq!(organization.sequence_number(), organization_sequence);
    assert_eq!(user.sequence_number(), user_sequence);
}

#[test]
fn rejection_does_not_change_inputs_or_creation_events() {
    let organization = organization("org-a", true);
    let user = user("user-a", "org-b", false);
    let organization_event = organization.created_event();
    let user_event = user.created_event();
    let organization_sequence = organization.sequence_number();
    let user_sequence = user.sequence_number();
    let eligibility = AccessEligibility::create();

    let result = eligibility.assess(&organization, &user);

    assert_eq!(
        result,
        Err(AssessAccessEligibilityError::OrganizationMismatch)
    );
    assert!(organization.is_active());
    assert!(organization.is_identified_by("org-a"));
    assert!(!user.is_available());
    assert!(user.is_identified_by("user-a"));
    assert!(!user.belongs_to(&organization));
    assert_eq!(organization.created_event(), organization_event);
    assert_eq!(user.created_event(), user_event);
    assert_eq!(organization.sequence_number(), organization_sequence);
    assert_eq!(user.sequence_number(), user_sequence);
}
