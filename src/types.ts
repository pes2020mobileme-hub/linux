export type VNode =
  | { type: "dir"; children: Record<string, VNode> }
  | { type: "file"; content: string; owner: string; mode: number };

export type VirtualUser = {
  username: string;
  uid: number;
  admin: boolean;
  home: string;
};

export type VirtualProcess = {
  pid: number;
  name: string;
  owner: string;
  status: "running" | "stopped";
};

export type PackageState = {
  installed: string[];
  updatedAt?: string;
};

export type VirtualServer = {
  name: string;
  createdAt: string;
  root: VNode;
  cwd: string[];
  currentUser: string;
  users: VirtualUser[];
  processes: VirtualProcess[];
  packages: PackageState;
  hostname: string;
  distro: string;
};

export type UserState = {
  servers: Record<string, VirtualServer>;
  activeServer: string | null;
};
