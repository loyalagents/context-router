import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';

describe('Locations GraphQL API (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;

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

  describe('createLocation mutation', () => {
    it('should create a location with HOME type', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
                userId
                type
                label
                address
                createdAt
                updatedAt
              }
            }
          `,
          variables: {
            data: {
              type: 'HOME',
              label: 'My Home',
              address: '123 Main Street, City, State 12345',
            },
          },
        })
        .expect(200);

      expect(response.body.data.createLocation).toBeDefined();
      expect(response.body.data.createLocation.locationId).toBeDefined();
      expect(response.body.data.createLocation.userId).toBe(testUser.userId);
      expect(response.body.data.createLocation.type).toBe('HOME');
      expect(response.body.data.createLocation.label).toBe('My Home');
      expect(response.body.data.createLocation.address).toBe(
        '123 Main Street, City, State 12345',
      );
    });

    it('should create a location with WORK type', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
                type
                label
                address
              }
            }
          `,
          variables: {
            data: {
              type: 'WORK',
              label: 'Office',
              address: '456 Business Ave, Suite 100',
            },
          },
        })
        .expect(200);

      expect(response.body.data.createLocation.type).toBe('WORK');
      expect(response.body.data.createLocation.label).toBe('Office');
    });

    it('should create a location with OTHER type', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
                type
                label
              }
            }
          `,
          variables: {
            data: {
              type: 'OTHER',
              label: 'Gym',
              address: '789 Fitness Lane',
            },
          },
        })
        .expect(200);

      expect(response.body.data.createLocation.type).toBe('OTHER');
      expect(response.body.data.createLocation.label).toBe('Gym');
    });

    it('should fail with invalid location type', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
              }
            }
          `,
          variables: {
            data: {
              type: 'INVALID',
              label: 'Test',
              address: 'Test Address',
            },
          },
        })
        .expect(200);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors[0].message).toContain(
        'Value "INVALID" does not exist in "LocationType" enum',
      );
    });

    it('should fail with empty label', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
              }
            }
          `,
          variables: {
            data: {
              type: 'HOME',
              label: '',
              address: 'Test Address',
            },
          },
        })
        .expect(200);

      expect(response.body.errors).toBeDefined();
    });
  });

  describe('locations query', () => {
    it('should return empty array when no locations exist', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            query {
              locations {
                locationId
                type
                label
              }
            }
          `,
        })
        .expect(200);

      expect(response.body.data.locations).toEqual([]);
    });

    it('should return all locations for user', async () => {
      // Create two locations
      await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
              }
            }
          `,
          variables: {
            data: {
              type: 'HOME',
              label: 'Home',
              address: '123 Home St',
            },
          },
        });

      await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
              }
            }
          `,
          variables: {
            data: {
              type: 'WORK',
              label: 'Work',
              address: '456 Work Ave',
            },
          },
        });

      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            query {
              locations {
                locationId
                type
                label
              }
            }
          `,
        })
        .expect(200);

      expect(response.body.data.locations).toHaveLength(2);
      expect(response.body.data.locations.map((l: any) => l.type)).toContain(
        'HOME',
      );
      expect(response.body.data.locations.map((l: any) => l.type)).toContain(
        'WORK',
      );
    });
  });

  describe('location query (single)', () => {
    it('should return a specific location by ID', async () => {
      // Create a location first
      const createResponse = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
                label
              }
            }
          `,
          variables: {
            data: {
              type: 'HOME',
              label: 'Test Home',
              address: '123 Test St',
            },
          },
        });

      const locationId = createResponse.body.data.createLocation.locationId;

      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            query GetLocation($locationId: String!) {
              location(locationId: $locationId) {
                locationId
                type
                label
                address
              }
            }
          `,
          variables: { locationId },
        })
        .expect(200);

      expect(response.body.data.location.locationId).toBe(locationId);
      expect(response.body.data.location.type).toBe('HOME');
      expect(response.body.data.location.label).toBe('Test Home');
    });

    it('should fail for non-existent location', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            query GetLocation($locationId: String!) {
              location(locationId: $locationId) {
                locationId
              }
            }
          `,
          variables: { locationId: 'non-existent-id' },
        })
        .expect(200);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors[0].message).toContain('not found');
    });
  });

  describe('locationsByType query', () => {
    it('should return locations filtered by type', async () => {
      // Create locations of different types
      await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
              }
            }
          `,
          variables: {
            data: {
              type: 'HOME',
              label: 'Home 1',
              address: '123 Home St',
            },
          },
        });

      await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
              }
            }
          `,
          variables: {
            data: {
              type: 'HOME',
              label: 'Home 2',
              address: '456 Home Ave',
            },
          },
        });

      await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
              }
            }
          `,
          variables: {
            data: {
              type: 'WORK',
              label: 'Work',
              address: '789 Work Blvd',
            },
          },
        });

      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            query GetLocationsByType($type: LocationType!) {
              locationsByType(type: $type) {
                locationId
                type
                label
              }
            }
          `,
          variables: { type: 'HOME' },
        })
        .expect(200);

      expect(response.body.data.locationsByType).toHaveLength(2);
      expect(
        response.body.data.locationsByType.every(
          (l: any) => l.type === 'HOME',
        ),
      ).toBe(true);
    });
  });

  describe('updateLocation mutation', () => {
    it('should update location label', async () => {
      // Create a location first
      const createResponse = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
              }
            }
          `,
          variables: {
            data: {
              type: 'HOME',
              label: 'Original Label',
              address: '123 Test St',
            },
          },
        });

      const locationId = createResponse.body.data.createLocation.locationId;

      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation UpdateLocation($locationId: String!, $data: UpdateLocationInput!) {
              updateLocation(locationId: $locationId, data: $data) {
                locationId
                label
              }
            }
          `,
          variables: {
            locationId,
            data: { label: 'Updated Label' },
          },
        })
        .expect(200);

      expect(response.body.data.updateLocation.label).toBe('Updated Label');
    });

    it('should update location address', async () => {
      // Create a location first
      const createResponse = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
              }
            }
          `,
          variables: {
            data: {
              type: 'WORK',
              label: 'Office',
              address: 'Old Address',
            },
          },
        });

      const locationId = createResponse.body.data.createLocation.locationId;

      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation UpdateLocation($locationId: String!, $data: UpdateLocationInput!) {
              updateLocation(locationId: $locationId, data: $data) {
                locationId
                address
              }
            }
          `,
          variables: {
            locationId,
            data: { address: 'New Address' },
          },
        })
        .expect(200);

      expect(response.body.data.updateLocation.address).toBe('New Address');
    });

    it('should update location type', async () => {
      // Create a location first
      const createResponse = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
              }
            }
          `,
          variables: {
            data: {
              type: 'OTHER',
              label: 'Location',
              address: '123 St',
            },
          },
        });

      const locationId = createResponse.body.data.createLocation.locationId;

      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation UpdateLocation($locationId: String!, $data: UpdateLocationInput!) {
              updateLocation(locationId: $locationId, data: $data) {
                locationId
                type
              }
            }
          `,
          variables: {
            locationId,
            data: { type: 'HOME' },
          },
        })
        .expect(200);

      expect(response.body.data.updateLocation.type).toBe('HOME');
    });

    it('should fail to update non-existent location', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation UpdateLocation($locationId: String!, $data: UpdateLocationInput!) {
              updateLocation(locationId: $locationId, data: $data) {
                locationId
              }
            }
          `,
          variables: {
            locationId: 'non-existent-id',
            data: { label: 'Test' },
          },
        })
        .expect(200);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors[0].message).toContain('not found');
    });
  });

  describe('deleteLocation mutation', () => {
    it('should delete a location', async () => {
      // Create a location first
      const createResponse = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation CreateLocation($data: CreateLocationInput!) {
              createLocation(data: $data) {
                locationId
              }
            }
          `,
          variables: {
            data: {
              type: 'HOME',
              label: 'To Delete',
              address: '123 Delete St',
            },
          },
        });

      const locationId = createResponse.body.data.createLocation.locationId;

      // Delete the location
      const deleteResponse = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation DeleteLocation($locationId: String!) {
              deleteLocation(locationId: $locationId) {
                locationId
                label
              }
            }
          `,
          variables: { locationId },
        })
        .expect(200);

      expect(deleteResponse.body.data.deleteLocation.locationId).toBe(
        locationId,
      );

      // Verify it's deleted
      const getResponse = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            query GetLocation($locationId: String!) {
              location(locationId: $locationId) {
                locationId
              }
            }
          `,
          variables: { locationId },
        })
        .expect(200);

      expect(getResponse.body.errors).toBeDefined();
      expect(getResponse.body.errors[0].message).toContain('not found');
    });

    it('should fail to delete non-existent location', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation DeleteLocation($locationId: String!) {
              deleteLocation(locationId: $locationId) {
                locationId
              }
            }
          `,
          variables: { locationId: 'non-existent-id' },
        })
        .expect(200);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors[0].message).toContain('not found');
    });
  });
});
