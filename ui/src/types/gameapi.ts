export interface SaveService {
  list(): Promise<Record<number, { exists: boolean; corrupted?: boolean }>>;
  load(slot: number): Promise<{ success: boolean; data?: any; error?: string; corruptBackupPath?: string }>;
  write(slot: number, data: any): Promise<{ success: boolean; error?: string }>;
  delete(slot: number): Promise<{ success: boolean; error?: string }>;
}

export interface LessonService {
  load(lessonId: string, className?: string): Promise<{ success: boolean; lesson?: any; error?: string }>;
  cast(params: { lessonId: string; playerCode: string; className: string }): Promise<any>;
}

export interface CombatService {
  start(params: {
    playerClass: string;
    encounterId: string;
    spells: any[];
    playerHp?: number;
    playerMp?: number;
  }): Promise<{ success: boolean; state?: any; encounter?: any; error?: string }>;
  turn(params: { action: string }): Promise<{ success: boolean; events?: any[]; state?: any; error?: string }>;
  end(): Promise<{ success: boolean; error?: string }>;
}

export interface ContentService {
  get(type: string, id?: string): Promise<any>;
}

export interface GameAPI {
  saves: SaveService;
  lessons: LessonService;
  combat: CombatService;
  content: ContentService;
}
