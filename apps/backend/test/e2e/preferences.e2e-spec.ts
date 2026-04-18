import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';
import { getPrismaClient } from '../setup/test-db';
import {
  AuditActorType,
  AuditEventType,
  AuditOrigin,
  PreferenceStatus,
  SourceType,
} from '../../src/infrastructure/prisma/generated-client';

describe('Preferences GraphQL API (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  const prisma = getPrismaClient();

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
  });

  beforeEach(async () => {
    // Create fresh user after resetDb()
    testUser = await createTestUser();
    setTestUser(testUser);
  });

  afterAll(async () => {
    await app.close();
  });

  const graphqlRequest = (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/graphql')
      .send({ query, variables });

  describe('setPreference mutation', () => {
    it('should create a global preference', async () => {
      const mutation = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
            userId
            slug
            definitionId
            value
            status
            sourceType
            locationId
            category
            description
          }
        }
      `;

      const response = await graphqlRequest(mutation, {
        input: {
          slug: 'food.dietary_restrictions',
          value: ['peanuts', 'shellfish'],
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.setPreference).toMatchObject({
        userId: testUser.userId,
        slug: 'food.dietary_restrictions',
        value: ['peanuts', 'shellfish'],
        status: 'ACTIVE',
        sourceType: 'USER',
        locationId: null,
        category: 'food',
      });
      expect(response.body.data.setPreference.id).toBeDefined();
      expect(response.body.data.setPreference.definitionId).toBeDefined();
      expect(response.body.data.setPreference.description).toBeDefined();

      const auditRows = await prisma.preferenceAuditEvent.findMany({
        where: { userId: testUser.userId },
      });

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        eventType: AuditEventType.PREFERENCE_SET,
        origin: AuditOrigin.GRAPHQL,
        actorType: AuditActorType.USER,
      });
      expect(auditRows[0].correlationId).toBeTruthy();
      expect(auditRows[0].afterState).toMatchObject({
        id: response.body.data.setPreference.id,
        slug: 'food.dietary_restrictions',
        value: ['peanuts', 'shellfish'],
        status: 'ACTIVE',
        sourceType: 'USER',
      });
    });

    it('should canonicalize array values before persisting', async () => {
      const mutation = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
            slug
            value
          }
        }
      `;

      const response = await graphqlRequest(mutation, {
        input: {
          slug: 'dev.tech_stack',
          value: ['AI', ' software engineering ', 'AI', ''],
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.setPreference).toMatchObject({
        slug: 'dev.tech_stack',
        value: ['AI', 'software engineering'],
      });
    });

    it('should create a location-scoped preference', async () => {
      // First create a location
      const createLocationMutation = `
        mutation CreateLocation($data: CreateLocationInput!) {
          createLocation(data: $data) {
            locationId
            label
          }
        }
      `;

      const locationResponse = await graphqlRequest(createLocationMutation, {
        data: {
          type: 'HOME',
          label: 'Test Home',
          address: '123 Main St',
        },
      }).expect(200);

      expect(locationResponse.body.errors).toBeUndefined();
      const locationId = locationResponse.body.data.createLocation.locationId;

      // Now create a location-scoped preference
      const mutation = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
            userId
            slug
            value
            locationId
            category
          }
        }
      `;

      const response = await graphqlRequest(mutation, {
        input: {
          slug: 'location.default_temperature',
          value: '72',
          locationId,
        },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.setPreference).toMatchObject({
        userId: testUser.userId,
        slug: 'location.default_temperature',
        value: '72',
        locationId,
        category: 'location',
      });
    });

    it('should update existing preference (upsert behavior)', async () => {
      const mutation = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
            slug
            value
          }
        }
      `;

      // Create first
      const createResponse = await graphqlRequest(mutation, {
        input: {
          slug: 'system.response_tone',
          value: 'casual',
        },
      }).expect(200);

      const id = createResponse.body.data.setPreference.id;

      // Update with same slug
      const updateResponse = await graphqlRequest(mutation, {
        input: {
          slug: 'system.response_tone',
          value: 'professional',
        },
      }).expect(200);

      expect(updateResponse.body.errors).toBeUndefined();
      expect(updateResponse.body.data.setPreference.id).toBe(id);
      expect(updateResponse.body.data.setPreference.value).toBe('professional');

      const auditRows = await prisma.preferenceAuditEvent.findMany({
        where: {
          userId: testUser.userId,
          eventType: AuditEventType.PREFERENCE_SET,
        },
      });

      expect(auditRows).toHaveLength(2);
      const updateAudit = auditRows.find(
        (auditRow) =>
          (auditRow.afterState as { value?: string } | null)?.value === 'professional',
      );

      expect(updateAudit).toBeDefined();
      expect(updateAudit?.beforeState).toMatchObject({
        id,
        value: 'casual',
        sourceType: 'USER',
      });
      expect(updateAudit?.afterState).toMatchObject({
        id,
        value: 'professional',
        sourceType: 'USER',
      });
    });

    it('should reject unknown slug', async () => {
      const mutation = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
          }
        }
      `;

      const response = await graphqlRequest(mutation, {
        input: {
          slug: 'unknown.invalid_slug',
          value: 'test',
        },
      }).expect(200);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors[0].message).toContain('Unknown preference slug');
      expect(
        await prisma.preferenceAuditEvent.count({
          where: { userId: testUser.userId },
        }),
      ).toBe(0);
    });
  });

  describe('activePreferences query', () => {
    it('should return all active preferences for the user', async () => {
      const setMutation = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
          }
        }
      `;

      await graphqlRequest(setMutation, {
        input: { slug: 'travel.seat_preference', value: 'aisle' },
      });

      await graphqlRequest(setMutation, {
        input: { slug: 'travel.meal_preference', value: 'vegetarian' },
      });

      // Query all active preferences
      const query = `
        query {
          activePreferences {
            id
            userId
            slug
            value
            status
          }
        }
      `;

      const response = await graphqlRequest(query).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.activePreferences).toBeInstanceOf(Array);
      expect(response.body.data.activePreferences.length).toBeGreaterThanOrEqual(2);

      // All should belong to test user and be ACTIVE
      response.body.data.activePreferences.forEach((pref: { userId: string; status: string }) => {
        expect(pref.userId).toBe(testUser.userId);
        expect(pref.status).toBe('ACTIVE');
      });
    });

    it('should return merged preferences when locationId is provided', async () => {
      // Create a location
      const createLocationMutation = `
        mutation CreateLocation($data: CreateLocationInput!) {
          createLocation(data: $data) {
            locationId
          }
        }
      `;

      const locationResponse = await graphqlRequest(createLocationMutation, {
        data: {
          type: 'HOME',
          label: 'Test Home',
          address: '123 Main St',
        },
      }).expect(200);

      const locationId = locationResponse.body.data.createLocation.locationId;

      // Create global and location-scoped preferences
      const setMutation = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
          }
        }
      `;

      await graphqlRequest(setMutation, {
        input: { slug: 'system.response_tone', value: 'casual' },
      });

      await graphqlRequest(setMutation, {
        input: { slug: 'location.default_temperature', value: '68', locationId },
      });

      // Query with locationId - should get both
      const query = `
        query GetActivePreferences($locationId: ID) {
          activePreferences(locationId: $locationId) {
            id
            slug
            locationId
          }
        }
      `;

      const response = await graphqlRequest(query, { locationId }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.activePreferences.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('preference query (single)', () => {
    it('should return a specific preference by ID', async () => {
      const setMutation = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
            slug
            value
          }
        }
      `;

      const createResponse = await graphqlRequest(setMutation, {
        input: { slug: 'food.spice_tolerance', value: 'medium' },
      });

      const id = createResponse.body.data.setPreference.id;

      // Query by ID
      const query = `
        query GetPreference($id: ID!) {
          preference(id: $id) {
            id
            userId
            slug
            value
            category
          }
        }
      `;

      const response = await graphqlRequest(query, { id }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.preference).toMatchObject({
        id,
        userId: testUser.userId,
        slug: 'food.spice_tolerance',
        value: 'medium',
        category: 'food',
      });
    });
  });

  describe('suggestedPreferences query', () => {
    it('should return suggested preferences (inbox)', async () => {
      const suggestMutation = `
        mutation SuggestPreference($input: SuggestPreferenceInput!) {
          suggestPreference(input: $input) {
            id
            slug
            value
            status
          }
        }
      `;

      await graphqlRequest(suggestMutation, {
        input: {
          slug: 'food.cuisine_preferences',
          value: ['Italian', 'Japanese'],
          confidence: 0.85,
        },
      });

      const query = `
        query {
          suggestedPreferences {
            id
            slug
            value
            status
            confidence
          }
        }
      `;

      const response = await graphqlRequest(query).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.suggestedPreferences).toBeInstanceOf(Array);
      expect(response.body.data.suggestedPreferences.length).toBeGreaterThanOrEqual(1);

      response.body.data.suggestedPreferences.forEach((pref: { status: string }) => {
        expect(pref.status).toBe('SUGGESTED');
      });

      const auditRows = await prisma.preferenceAuditEvent.findMany({
        where: { userId: testUser.userId },
      });

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        eventType: AuditEventType.PREFERENCE_SUGGESTED_UPSERTED,
        origin: AuditOrigin.GRAPHQL,
        actorType: AuditActorType.USER,
      });
      expect(auditRows[0].correlationId).toBeTruthy();
      expect(auditRows[0].afterState).toMatchObject({
        status: 'SUGGESTED',
        slug: 'food.cuisine_preferences',
        value: ['Italian', 'Japanese'],
        sourceType: 'INFERRED',
      });
    });

    it('should update an existing suggestion and capture beforeState in the audit event', async () => {
      const suggestMutation = `
        mutation SuggestPreference($input: SuggestPreferenceInput!) {
          suggestPreference(input: $input) {
            id
            value
            confidence
          }
        }
      `;

      const initialResponse = await graphqlRequest(suggestMutation, {
        input: {
          slug: 'food.cuisine_preferences',
          value: ['Italian'],
          confidence: 0.51,
          evidence: { source: 'chat', snippet: 'Usually picks Italian' },
        },
      }).expect(200);

      const updatedResponse = await graphqlRequest(suggestMutation, {
        input: {
          slug: 'food.cuisine_preferences',
          value: ['Italian', 'Japanese'],
          confidence: 0.93,
          evidence: { source: 'chat', snippet: 'Also likes Japanese food' },
        },
      }).expect(200);

      expect(initialResponse.body.errors).toBeUndefined();
      expect(updatedResponse.body.errors).toBeUndefined();
      expect(updatedResponse.body.data.suggestPreference.id).toBe(
        initialResponse.body.data.suggestPreference.id,
      );

      const auditRows = await prisma.preferenceAuditEvent.findMany({
        where: {
          userId: testUser.userId,
          eventType: AuditEventType.PREFERENCE_SUGGESTED_UPSERTED,
        },
      });

      expect(auditRows).toHaveLength(2);
      const updateAudit = auditRows.find(
        (auditRow) =>
          (auditRow.afterState as { confidence?: number } | null)?.confidence === 0.93,
      );

      expect(updateAudit).toBeDefined();
      expect(updateAudit?.beforeState).toMatchObject({
        id: initialResponse.body.data.suggestPreference.id,
        value: ['Italian'],
        confidence: 0.51,
        evidence: { source: 'chat', snippet: 'Usually picks Italian' },
      });
      expect(updateAudit?.afterState).toMatchObject({
        id: initialResponse.body.data.suggestPreference.id,
        value: ['Italian', 'Japanese'],
        confidence: 0.93,
        evidence: { source: 'chat', snippet: 'Also likes Japanese food' },
      });
    });

    it('should not write an audit row when suggestion input fails validation', async () => {
      const suggestMutation = `
        mutation SuggestPreference($input: SuggestPreferenceInput!) {
          suggestPreference(input: $input) {
            id
          }
        }
      `;

      const response = await graphqlRequest(suggestMutation, {
        input: {
          slug: 'food.cuisine_preferences',
          value: ['Italian'],
          confidence: 1.5,
        },
      }).expect(200);

      expect(response.body.errors).toBeDefined();
      expect(
        await prisma.preferenceAuditEvent.count({
          where: { userId: testUser.userId },
        }),
      ).toBe(0);
    });
  });

  describe('acceptSuggestedPreference mutation', () => {
    it('should promote a suggested preference to ACTIVE', async () => {
      // Create a suggestion
      const suggestMutation = `
        mutation SuggestPreference($input: SuggestPreferenceInput!) {
          suggestPreference(input: $input) {
            id
          }
        }
      `;

      const suggestResponse = await graphqlRequest(suggestMutation, {
        input: {
          slug: 'dev.tech_stack',
          value: ['TypeScript', 'Node.js'],
          confidence: 0.9,
          evidence: { source: 'chat', snippet: 'Uses TS and Node.js daily' },
        },
      });

      const id = suggestResponse.body.data.suggestPreference.id;

      // Accept the suggestion
      const acceptMutation = `
        mutation AcceptSuggestion($id: ID!) {
          acceptSuggestedPreference(id: $id) {
            id
            status
            value
          }
        }
      `;

      const response = await graphqlRequest(acceptMutation, { id }).expect(200);

      expect(response.body.errors).toBeUndefined();
      // Note: acceptSuggestedPreference creates a new ACTIVE preference (via upsert)
      // and deletes the original suggestion, so the ID may be different.
      // See docs/PREFERENCES_MVP_STRICT_IMPLEMENTATION.md line 293:
      // "On accept: upsert new ACTIVE row with the suggested value, then delete the SUGGESTED row"
      expect(response.body.data.acceptSuggestedPreference).toMatchObject({
        status: 'ACTIVE',
        value: ['TypeScript', 'Node.js'],
      });
      expect(response.body.data.acceptSuggestedPreference.id).toBeDefined();

      const activeRow = await prisma.preference.findUnique({
        where: { id: response.body.data.acceptSuggestedPreference.id },
      });

      expect(activeRow).toMatchObject({
        status: 'ACTIVE',
        sourceType: 'INFERRED',
        confidence: 0.9,
        evidence: { source: 'chat', snippet: 'Uses TS and Node.js daily' },
      });

      const acceptedAuditRows = await prisma.preferenceAuditEvent.findMany({
        where: {
          userId: testUser.userId,
          eventType: AuditEventType.PREFERENCE_SUGGESTION_ACCEPTED,
        },
      });

      expect(acceptedAuditRows).toHaveLength(1);
      expect(acceptedAuditRows[0].metadata).toMatchObject({
        consumedSuggestion: {
          id,
          sourceType: 'INFERRED',
          confidence: 0.9,
          evidence: { source: 'chat', snippet: 'Uses TS and Node.js daily' },
        },
      });
    });

    it('should capture the previous ACTIVE row in the accept audit beforeState', async () => {
      const setMutation = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
          }
        }
      `;
      const suggestMutation = `
        mutation SuggestPreference($input: SuggestPreferenceInput!) {
          suggestPreference(input: $input) {
            id
          }
        }
      `;
      const acceptMutation = `
        mutation AcceptSuggestion($id: ID!) {
          acceptSuggestedPreference(id: $id) {
            id
            value
            status
          }
        }
      `;

      const existingActive = await graphqlRequest(setMutation, {
        input: {
          slug: 'dev.tech_stack',
          value: ['Python'],
        },
      }).expect(200);

      const suggestResponse = await graphqlRequest(suggestMutation, {
        input: {
          slug: 'dev.tech_stack',
          value: ['TypeScript', 'Node.js'],
          confidence: 0.82,
          evidence: { source: 'resume', snippet: 'Primary stack is TS/Node' },
        },
      }).expect(200);

      const suggestionId = suggestResponse.body.data.suggestPreference.id;

      const response = await graphqlRequest(acceptMutation, { id: suggestionId }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.acceptSuggestedPreference).toMatchObject({
        status: 'ACTIVE',
        value: ['TypeScript', 'Node.js'],
      });

      const acceptedAuditRows = await prisma.preferenceAuditEvent.findMany({
        where: {
          userId: testUser.userId,
          eventType: AuditEventType.PREFERENCE_SUGGESTION_ACCEPTED,
        },
      });

      expect(acceptedAuditRows).toHaveLength(1);
      expect(acceptedAuditRows[0].beforeState).toMatchObject({
        id: existingActive.body.data.setPreference.id,
        status: 'ACTIVE',
        value: ['Python'],
        sourceType: 'USER',
      });
      expect(acceptedAuditRows[0].afterState).toMatchObject({
        status: 'ACTIVE',
        value: ['TypeScript', 'Node.js'],
        sourceType: 'INFERRED',
      });
    });

    it('should promote a canonicalized array value when accepting a suggestion', async () => {
      const suggestMutation = `
        mutation SuggestPreference($input: SuggestPreferenceInput!) {
          suggestPreference(input: $input) {
            id
          }
        }
      `;

      const suggestResponse = await graphqlRequest(suggestMutation, {
        input: {
          slug: 'dev.tech_stack',
          value: ['AI', ' software engineering ', 'AI'],
          confidence: 0.94,
        },
      }).expect(200);

      const id = suggestResponse.body.data.suggestPreference.id;

      const acceptMutation = `
        mutation AcceptSuggestion($id: ID!) {
          acceptSuggestedPreference(id: $id) {
            id
            status
            value
          }
        }
      `;

      const response = await graphqlRequest(acceptMutation, { id }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.acceptSuggestedPreference).toMatchObject({
        status: 'ACTIVE',
        value: ['AI', 'software engineering'],
      });
    });
  });

  describe('rejectSuggestedPreference mutation', () => {
    it('should reject a suggested preference', async () => {
      // Create a suggestion
      const suggestMutation = `
        mutation SuggestPreference($input: SuggestPreferenceInput!) {
          suggestPreference(input: $input) {
            id
          }
        }
      `;

      const suggestResponse = await graphqlRequest(suggestMutation, {
        input: {
          slug: 'communication.preferred_channels',
          value: ['email'],
          confidence: 0.7,
          evidence: { source: 'ticket', snippet: 'Prefers email follow-up' },
        },
      });

      const id = suggestResponse.body.data.suggestPreference.id;

      // Reject the suggestion
      const rejectMutation = `
        mutation RejectSuggestion($id: ID!) {
          rejectSuggestedPreference(id: $id)
        }
      `;

      const response = await graphqlRequest(rejectMutation, { id }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.rejectSuggestedPreference).toBe(true);

      // Verify it's no longer in suggestions
      const query = `
        query {
          suggestedPreferences {
            id
          }
        }
      `;

      const checkResponse = await graphqlRequest(query).expect(200);
      const ids = checkResponse.body.data.suggestedPreferences.map((p: { id: string }) => p.id);
      expect(ids).not.toContain(id);

      const rejectedRows = await prisma.preference.findMany({
        where: {
          userId: testUser.userId,
          status: 'REJECTED',
        },
      });

      expect(rejectedRows).toHaveLength(1);
      expect(rejectedRows[0]).toMatchObject({
        sourceType: 'INFERRED',
        confidence: 0.7,
        evidence: { source: 'ticket', snippet: 'Prefers email follow-up' },
      });

      const rejectedAuditRows = await prisma.preferenceAuditEvent.findMany({
        where: {
          userId: testUser.userId,
          eventType: AuditEventType.PREFERENCE_SUGGESTION_REJECTED,
        },
      });

      expect(rejectedAuditRows).toHaveLength(1);
      expect(rejectedAuditRows[0].metadata).toMatchObject({
        consumedSuggestion: {
          id,
          sourceType: 'INFERRED',
          confidence: 0.7,
          evidence: { source: 'ticket', snippet: 'Prefers email follow-up' },
        },
      });

      const resuggestResponse = await graphqlRequest(suggestMutation, {
        input: {
          slug: 'communication.preferred_channels',
          value: ['email'],
          confidence: 0.95,
          evidence: { source: 'ticket', snippet: 'Same preference repeated' },
        },
      }).expect(200);

      expect(resuggestResponse.body.errors).toBeUndefined();
      expect(resuggestResponse.body.data.suggestPreference).toBeNull();

      expect(
        await prisma.preferenceAuditEvent.count({
          where: {
            userId: testUser.userId,
            eventType: AuditEventType.PREFERENCE_SUGGESTED_UPSERTED,
          },
        }),
      ).toBe(1);
    });

    it('should capture the previous REJECTED row in the reject audit beforeState', async () => {
      const definition = await prisma.preferenceDefinition.findFirstOrThrow({
        where: {
          slug: 'communication.preferred_channels',
          archivedAt: null,
        },
      });

      const existingRejected = await prisma.preference.create({
        data: {
          userId: testUser.userId,
          definitionId: definition.id,
          contextKey: 'GLOBAL',
          value: ['sms'],
          status: PreferenceStatus.REJECTED,
          sourceType: SourceType.INFERRED,
          confidence: 0.21,
          evidence: { source: 'old-ticket', snippet: 'Previously rejected SMS' },
        },
      });

      const suggestion = await prisma.preference.create({
        data: {
          userId: testUser.userId,
          definitionId: definition.id,
          contextKey: 'GLOBAL',
          value: ['email'],
          status: PreferenceStatus.SUGGESTED,
          sourceType: SourceType.INFERRED,
          confidence: 0.74,
          evidence: { source: 'new-ticket', snippet: 'Latest preference is email' },
        },
      });

      const rejectMutation = `
        mutation RejectSuggestion($id: ID!) {
          rejectSuggestedPreference(id: $id)
        }
      `;

      const response = await graphqlRequest(rejectMutation, {
        id: suggestion.id,
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.rejectSuggestedPreference).toBe(true);

      const rejectedAuditRows = await prisma.preferenceAuditEvent.findMany({
        where: {
          userId: testUser.userId,
          eventType: AuditEventType.PREFERENCE_SUGGESTION_REJECTED,
        },
      });

      expect(rejectedAuditRows).toHaveLength(1);
      expect(rejectedAuditRows[0].beforeState).toMatchObject({
        id: existingRejected.id,
        status: 'REJECTED',
        value: ['sms'],
        confidence: 0.21,
        evidence: { source: 'old-ticket', snippet: 'Previously rejected SMS' },
      });
      expect(rejectedAuditRows[0].afterState).toMatchObject({
        id: existingRejected.id,
        status: 'REJECTED',
        value: ['email'],
        confidence: 0.74,
        evidence: { source: 'new-ticket', snippet: 'Latest preference is email' },
      });
    });
  });

  describe('definitionId correctness', () => {
    it('should return a definitionId that matches the id of the resolved definition', async () => {
      // Query catalog to find the known definition id for 'food.dietary_restrictions'
      const CATALOG_QUERY = `
        query PreferenceCatalog {
          preferenceCatalog {
            id
            slug
          }
        }
      `;
      const catalogRes = await graphqlRequest(CATALOG_QUERY).expect(200);
      const catalogDef = catalogRes.body.data.preferenceCatalog.find(
        (d: { slug: string }) => d.slug === 'food.dietary_restrictions',
      );
      expect(catalogDef).toBeDefined();
      const expectedDefinitionId = catalogDef.id;

      // Set a preference using that slug
      const SET_MUTATION = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
            slug
            definitionId
          }
        }
      `;
      const response = await graphqlRequest(SET_MUTATION, {
        input: { slug: 'food.dietary_restrictions', value: ['gluten'] },
      }).expect(200);

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.setPreference.definitionId).toBe(expectedDefinitionId);
    });
  });

  describe('deletePreference mutation', () => {
    it('should delete an existing preference', async () => {
      const setMutation = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
          }
        }
      `;

      const createResponse = await graphqlRequest(setMutation, {
        input: { slug: 'system.response_length', value: 'brief' },
      });

      const id = createResponse.body.data.setPreference.id;

      // Delete the preference
      const deleteMutation = `
        mutation DeletePreference($id: ID!) {
          deletePreference(id: $id) {
            id
          }
        }
      `;

      const deleteResponse = await graphqlRequest(deleteMutation, { id }).expect(200);

      expect(deleteResponse.body.errors).toBeUndefined();
      expect(deleteResponse.body.data.deletePreference.id).toBe(id);

      // Verify it's deleted by trying to fetch it
      const query = `
        query GetPreference($id: ID!) {
          preference(id: $id) {
            id
          }
        }
      `;

      const getResponse = await graphqlRequest(query, { id }).expect(200);

      // Should return an error (preference not found)
      expect(getResponse.body.errors).toBeDefined();

      const deleteAuditRows = await prisma.preferenceAuditEvent.findMany({
        where: {
          userId: testUser.userId,
          eventType: AuditEventType.PREFERENCE_DELETED,
        },
      });

      expect(deleteAuditRows).toHaveLength(1);
      expect(deleteAuditRows[0]).toMatchObject({
        origin: AuditOrigin.GRAPHQL,
        actorType: AuditActorType.USER,
        afterState: null,
      });
      expect(deleteAuditRows[0].beforeState).toMatchObject({
        id,
        slug: 'system.response_length',
        value: 'brief',
      });
    });
  });
});
