import { versionApi } from './version';

type HasRuntimeProbe = 'detectRuntimeKind' extends keyof typeof versionApi ? true : false;

const versionApiDoesNotExposeRuntimeProbe: false = null as unknown as HasRuntimeProbe;

void versionApiDoesNotExposeRuntimeProbe;
