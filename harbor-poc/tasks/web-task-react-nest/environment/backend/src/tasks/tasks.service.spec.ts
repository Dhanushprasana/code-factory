import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../app.module';

describe('Tasks API (Integration Automation Tests)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /tasks should return empty array initially', async () => {
    const res = await request(app.getHttpServer()).get('/tasks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /tasks should create a LOW priority task', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .send({ title: 'Task 1', priority: 'LOW' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Task 1');
    expect(res.body.priority).toBe('LOW');
  });

  it('POST /tasks should create a HIGH priority task', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .send({ title: 'Critical Bug', priority: 'HIGH' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Critical Bug');
    expect(res.body.priority).toBe('HIGH');
  });

  it('POST /tasks should reject invalid priorities with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .send({ title: 'Invalid Task', priority: 'URGENT' });
    expect(res.status).toBe(400);
  });
});
