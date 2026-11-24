export type ProjectOption = {
  id: string;
  name: string;
};

export type ProjectRepository = {
  id: string;
  repositoryId: string;
  repoRole: string;
  selectedBranch: string | null;
  selectedCommitSha: string | null;
  repository: {
    fullName: string;
    defaultBranch: string;
  };
};
