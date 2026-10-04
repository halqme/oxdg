import { dirname } from "node:path";

export interface NpmPackageModule {
  id: string;
  absolutePath: string;
}

export function isNodeModulesPath(filePath: string): boolean {
  return filePath.replaceAll("\\", "/").split("/").includes("node_modules");
}

export function npmPackageFromPath(filePath: string): NpmPackageModule | undefined {
  const segments = filePath.replaceAll("\\", "/").split("/");
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  const packageIndex = nodeModulesIndex + 1;
  if (nodeModulesIndex === -1) {
    return undefined;
  }

  const packageSegment = segments[packageIndex];
  if (packageSegment === undefined || packageSegment.length === 0) {
    return undefined;
  }

  let packageName = packageSegment;
  let packagePathEnd = packageIndex + 1;
  if (packageSegment.startsWith("@")) {
    const scopedPackage = segments[packagePathEnd];
    if (scopedPackage === undefined || scopedPackage.length === 0) {
      return undefined;
    }
    packageName = `${packageSegment}/${scopedPackage}`;
    packagePathEnd += 1;
  }

  let absolutePath = filePath;
  for (let index = packagePathEnd; index < segments.length; index += 1) {
    absolutePath = dirname(absolutePath);
  }

  return { id: `npm:${packageName}`, absolutePath };
}
