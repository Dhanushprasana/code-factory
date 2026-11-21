import { AppService } from './app.service';

describe('AppService', () => {
  it('exports package metadata', () => {
    const service = new AppService();
    const exported = service.exportPackage('pkg-coupon-v1');
    expect(exported).not.toBeNull();
    expect(exported?.schema).toBe('v1');
  });
});
