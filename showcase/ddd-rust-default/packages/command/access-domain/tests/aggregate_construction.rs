use access_domain::access::organization::{
    CorruptOrganizationHistory, CreateOrganizationError, Organization,
};
use access_domain::access::user::{CorruptUserHistory, CreateUserError, User};

fn organization(id: &str, active: bool) -> Organization {
    Organization::create(Some(id), Some(active)).expect("利用組織を作成できる入力")
}

fn user(id: &str, organization_id: &str, available: bool) -> User {
    User::create(Some(id), Some(organization_id), Some(available)).expect("利用者を作成できる入力")
}

#[test]
fn organization_rejects_a_missing_identifier() {
    let result = Organization::create(None, Some(true));

    assert!(matches!(result, Err(CreateOrganizationError::MissingId)));
}

#[test]
fn organization_rejects_a_missing_active_status() {
    let result = Organization::create(Some("org-a"), None);

    assert!(matches!(
        result,
        Err(CreateOrganizationError::MissingActive)
    ));
}

#[test]
fn user_rejects_a_missing_identifier() {
    let result = User::create(None, Some("org-a"), Some(true));

    assert!(matches!(result, Err(CreateUserError::MissingId)));
}

#[test]
fn user_rejects_a_missing_organization_identifier() {
    let result = User::create(Some("user-a"), None, Some(true));

    assert!(matches!(
        result,
        Err(CreateUserError::MissingOrganizationId)
    ));
}

#[test]
fn user_rejects_a_missing_available_status() {
    let result = User::create(Some("user-a"), Some("org-a"), None);

    assert!(matches!(result, Err(CreateUserError::MissingAvailable)));
}

#[test]
fn empty_identifiers_and_false_statuses_are_valid_inputs() {
    let organization = organization("", false);
    let user = user("", "", false);

    assert!(!organization.is_active());
    assert!(organization.is_identified_by(""));
    assert!(!user.is_available());
    assert!(user.is_identified_by(""));
    assert!(user.belongs_to(&organization));
}

#[test]
fn user_membership_follows_organization_identity_across_instances() {
    let first_instance = organization("org-a", true);
    let another_instance = organization("org-a", false);
    let different_organization = organization("org-b", true);
    let user = user("user-a", "org-a", true);

    assert!(user.belongs_to(&first_instance));
    assert!(user.belongs_to(&another_instance));
    assert!(!user.belongs_to(&different_organization));
}

#[test]
fn aggregates_can_be_restored_from_their_creation_events() {
    let original_organization = organization("org-a", true);
    let original_user = user("user-a", "org-a", true);

    let restored_organization = Organization::from_created(&original_organization.created_event());
    let restored_user = User::from_created(&original_user.created_event());

    assert!(restored_organization.is_active());
    assert!(restored_organization.is_identified_by("org-a"));
    assert!(restored_user.is_available());
    assert!(restored_user.is_identified_by("user-a"));
    assert!(restored_user.belongs_to(&restored_organization));
}

#[test]
fn replay_without_following_events_preserves_the_current_aggregates() {
    let organization = organization("org-a", true);
    let user = user("user-a", "org-a", true);
    let organization_event = organization.created_event();
    let user_event = user.created_event();

    let restored_organization =
        Organization::replay(&[], organization).expect("空の続きは有効な履歴");
    let restored_user = User::replay(&[], user).expect("空の続きは有効な履歴");

    assert!(restored_organization.is_active());
    assert!(restored_organization.is_identified_by("org-a"));
    assert!(restored_user.is_available());
    assert!(restored_user.is_identified_by("user-a"));
    assert!(restored_user.belongs_to(&restored_organization));
    assert_eq!(restored_organization.sequence_number(), 1);
    assert_eq!(restored_user.sequence_number(), 1);
    assert_eq!(restored_organization.created_event(), organization_event);
    assert_eq!(restored_user.created_event(), user_event);
}

#[test]
fn creation_and_restoration_preserve_sequence_one_and_creation_events() {
    let organization = organization("org-a", false);
    let user = user("user-a", "org-a", false);
    let organization_event = organization.created_event();
    let user_event = user.created_event();

    let restored_organization = Organization::from_created(&organization_event);
    let restored_user = User::from_created(&user_event);

    assert_eq!(organization.sequence_number(), 1);
    assert_eq!(user.sequence_number(), 1);
    assert_eq!(restored_organization.sequence_number(), 1);
    assert_eq!(restored_user.sequence_number(), 1);
    assert_eq!(restored_organization.created_event(), organization_event);
    assert_eq!(restored_user.created_event(), user_event);
    assert!(!restored_organization.is_active());
    assert!(restored_organization.is_identified_by("org-a"));
    assert!(!restored_user.is_available());
    assert!(restored_user.is_identified_by("user-a"));
    assert!(!restored_user.is_identified_by("user-b"));
    assert!(restored_user.belongs_to(&restored_organization));
}

#[test]
fn organization_rejects_a_creation_event_after_an_existing_snapshot() {
    let organization = organization("org-a", true);
    let event = organization.created_event();

    let result = Organization::replay(&[event], organization);

    assert!(matches!(result, Err(CorruptOrganizationHistory)));
}

#[test]
fn user_rejects_a_creation_event_after_an_existing_snapshot() {
    let user = user("user-a", "org-a", true);
    let event = user.created_event();

    let result = User::replay(&[event], user);

    assert!(matches!(result, Err(CorruptUserHistory)));
}
