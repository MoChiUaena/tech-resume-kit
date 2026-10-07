export interface Contact { text: string; href: string }
export interface Asset { src: string; alt: string }
export type Block = { type: 'paragraph'; text: string } | { type: 'list'; items: string[]; ordered: boolean; start?: number };
export interface Entry { title: string; date?: string; subtitle?: string; stack?: string; blocks: Block[] }
export type Section = { id: string; title: string } & (
  { kind: 'entries'; entries: Entry[] } | { kind: 'skills'; items: { label: string; text: string }[] } | { kind: 'lines'; blocks: Block[] }
);
export interface ResumeDocument {
  schemaVersion: '0.2.0'; locale?: 'zh-CN';
  person: { name: string; target: string; label?: string; availability?: string; contacts: Contact[] };
  assets?: { schoolLogo?: Asset; portrait?: Asset }; sections: Section[]; notice?: string;
}
export interface ImageConfig { enabled?: boolean; widthMm?: number; heightMm?: number; slot?: 'start' | 'end'; align?: 'top' | 'center' | 'bottom' }
export type ResumeThemeId = 'ink-blue' | 'minimal-mono' | 'slate-banner' | 'forest-rail' | 'warm-labels' | 'graphite-grid';
export interface LayoutConfig {
  schemaVersion: '0.2.0'; theme?: ResumeThemeId; preset?: 'campus' | 'experience';
  page?: { size?: 'A4'; marginMm?: number; marginHorizontalMm?: number; marginTopMm?: number; marginBottomMm?: number; maxPages?: 1 | 2 };
  density?: 'standard' | 'compact'; fontFamily?: 'sans' | 'serif';
  bodyPt?: number; lineHeight?: number; namePt?: number; accent?: string; sectionOrder?: string[];
  header?: { gapMm?: number; align?: 'theme' | 'left' | 'center' | 'spread'; contactStyle?: 'plain' | 'labeled' };
  spacing?: { sectionMm?: number; entryMm?: number };
  images?: { schoolLogo?: ImageConfig; portrait?: ImageConfig };
}
export type NormalizedDocument = ResumeDocument & { locale: 'zh-CN'; assets: NonNullable<ResumeDocument['assets']> };
export type NormalizedLayout = Required<Omit<LayoutConfig, 'page' | 'images' | 'header' | 'spacing'>> & {
  page: Required<Pick<NonNullable<LayoutConfig['page']>, 'size' | 'marginMm' | 'maxPages'>> & Pick<NonNullable<LayoutConfig['page']>, 'marginHorizontalMm' | 'marginTopMm' | 'marginBottomMm'>;
  header: Required<NonNullable<LayoutConfig['header']>>;
  spacing: Required<NonNullable<LayoutConfig['spacing']>>; images: { schoolLogo: Required<ImageConfig>; portrait: Required<ImageConfig> };
};
export interface SourceLocation { file?: string; line?: number }
export type Locations = Map<string, SourceLocation>;
export interface RenderOptions { assetBase?: string; locations?: Locations; layoutLocations?: Locations }
export interface LoadedResume extends RenderOptions {
  document: NormalizedDocument; layout: NormalizedLayout; locations: Locations; layoutLocations: Locations;
  inputFile: string; configFile?: string; assetBase: string;
}
export interface PreparedImage extends Required<ImageConfig>, Asset { data: string; width: number; height: number; filename: string }
export interface RenderedResume {
  html: string; document: NormalizedDocument; layout: NormalizedLayout;
  images: Partial<Record<'portrait' | 'schoolLogo', PreparedImage>>; warnings: string[]; files: string[];
}
export interface Rect { x: number; y: number; width: number; height: number; bottom: number; right: number }
export interface ExportMetrics {
  browser: string; offline: true; networkRequests: string[]; contentWidthPx: number; contentHeightPx: number;
  pageCount: number; maxPages: 1 | 2; warnings: string[]; pageSizesPt: { width: number; height: number }[];
  sheet: Rect; identity: Rect; bodySize: string; overlap: boolean; outOfBounds: string[];
  images: (Rect & { asset: string; naturalWidth: number; naturalHeight: number })[];
  headingGroups: { label: string; height: number }[]; sections: (Rect & { title: string })[];
}
export interface ExportResult { buffer: undefined; warnings: string[]; metrics: ExportMetrics }
export interface PdfExportResult { buffer: Uint8Array; warnings: string[]; metrics: ExportMetrics }
export interface ErrorDetails { file?: string; line?: number; field?: string; code?: string; reason?: string }
export class ResumeError extends Error {
  constructor(message: string, details?: ErrorDetails);
  file?: string; line?: number; field?: string; code: string; reason?: string;
  toString(): string; toJSON(): ErrorDetails & { code: string; message: string };
}
export function parseResume(source: string, file?: string): { document: NormalizedDocument; locations: Locations };
export function loadResume(inputPath: string, configPath?: string): Promise<LoadedResume>;
export function parseResumeJson(source: string, file?: string): Pick<LoadedResume, 'document' | 'layout' | 'locations' | 'layoutLocations'>;
export function loadResumeJson(inputPath: string, options?: { assetBase?: string }): Promise<LoadedResume>;
export interface WorkbenchImageSlot {
  id: string | null; visible: boolean; widthMm: number; heightMm: number; fit: 'cover' | 'contain';
  quarterTurns: number; zoom: number; positionX: number; positionY: number;
}
export interface WorkbenchPresentation {
  language: 'zh' | 'en'; accentColor: string; alignment: 'left' | 'center' | 'justify';
  contactStyle: 'labels' | 'icons' | 'plain'; headingStyle: 'template' | 'line' | 'bar' | 'plain';
  marginHorizontalMm: number; marginTopMm: number; marginBottomMm: number; entryGapMm: number; paragraphGapMm: number;
}
export interface WorkbenchDocument {
  schemaVersion: 2 | 3 | 4;
  content: { name: string; headline: string; email: string; phone: string; location: string; sections: {
    id: string; type: 'education' | 'experience' | 'project' | 'skills' | 'custom'; title: string; visible: boolean; pageBreakBefore: boolean;
    entries: { id: string; title: string; meta: string; bulleted: boolean; bullets: string[] }[];
  }[] };
  layout: { template: 'classic' | 'banner' | 'card' | 'rail'; font: 'sans' | 'serif'; fontSize: number; lineHeight: number;
    sectionGapMm: number; marginMm: number; swapImages: boolean; photo: WorkbenchImageSlot; logo: WorkbenchImageSlot; presentation?: WorkbenchPresentation;
  };
}
export interface WorkbenchAssetMapping { id: string; src: string; alt?: string; prepared?: boolean }
export interface WorkbenchConversionOptions {
  layout: LayoutConfig; assets?: { portrait?: WorkbenchAssetMapping; schoolLogo?: WorkbenchAssetMapping }; pageBreaks?: 'natural';
}
export interface WorkbenchConversionReport {
  sourceSchemaVersion: 2 | 3 | 4; targetSchemaVersion: '0.2.0';
  sections: { sourceId: string; targetId: string; kind: 'entries' | 'lines'; entryIds: string[] }[];
  omitted: { field: string; id: string; reason: 'hidden' | 'empty' }[];
  layoutChanges: { field: string; from: string | number | boolean; to: string | number }[];
}
export interface WorkbenchConversion { document: NormalizedDocument; layout: NormalizedLayout; report: WorkbenchConversionReport; warnings: string[] }
export function convertWorkbenchResume(input: WorkbenchDocument, options: WorkbenchConversionOptions): WorkbenchConversion;
export function loadWorkbenchResume(inputPath: string, options: WorkbenchConversionOptions): Promise<WorkbenchConversion & { inputFile: string; assetBase: string }>;
export function loadWorkbenchResume(inputPath: string, options: WorkbenchConversionOptions | undefined, context: { assetBase?: string; optionsFile?: string }): Promise<WorkbenchConversion & { inputFile: string; assetBase: string }>;
export function renderResume(document: ResumeDocument, layout: LayoutConfig, options?: RenderOptions): Promise<RenderedResume>;
export function inspectAndExport(rendered: RenderedResume, options: { pdf: true }): Promise<PdfExportResult>;
export function inspectAndExport(rendered: RenderedResume, options?: { pdf?: false }): Promise<ExportResult>;
export function inspectAndExport(rendered: RenderedResume, options: { pdf: boolean }): Promise<ExportResult | PdfExportResult>;
export type StarterTemplateId = 'blank' | 'campus' | 'experience' | 'frontend' | 'java-backend' | 'python-backend' | 'ai-intern' | 'data-analyst' | 'qa-engineer' | 'android';
export function initializeProject(directory: string, template?: StarterTemplateId, options?: { theme?: ResumeThemeId }): Promise<string>;
