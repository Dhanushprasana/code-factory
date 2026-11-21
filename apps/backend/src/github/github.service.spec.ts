import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { GitHubService } from './github.service';

const mockSearchRepos = jest.fn();

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    search: { repos: mockSearchRepos },
  })),
}));

describe('GitHubService', () => {
  const service = new GitHubService();

  afterEach(() => {
    mockSearchRepos.mockReset();
  });

  it('accepts standard GitHub HTTPS repository URLs', () => {
    expect(service.parseRepositoryUrl('https://github.com/acme/shop.git')).toEqual({
      owner: 'acme',
      name: 'shop',
    });
  });

  it.each([
    'https://user:token@github.com/acme/shop',
    'http://github.com/acme/shop',
    'https://github.com.evil.example/acme/shop',
    'https://github.com/acme/shop?redirect=example.com',
    'https://github.com/acme/shop/tree/main',
  ])('rejects unsafe or non-repository URL %s', (url) => {
    expect(() => service.parseRepositoryUrl(url)).toThrow(BadRequestException);
  });

  it('returns an actionable error when GitHub rejects the configured credentials', async () => {
    mockSearchRepos.mockRejectedValueOnce({ status: 401, message: 'Bad credentials' });

    await expect(service.listRepositories('react-nest-ecommerce')).rejects.toThrow(
      BadGatewayException,
    );
  });
});
