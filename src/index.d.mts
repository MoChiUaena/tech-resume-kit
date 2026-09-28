export interface Contact { text: string; href: string }
export interface Asset { src: string; alt: string }
export type Block = { type: 'paragraph'; text: string } | { type: 'list'; items: string[]; ordered: boolean; start?: number };
export interface Entry { title: string; date: string; subtitle?: string; stack?: string; blocks: Block[] }
export type Section = { id: string; title: string } & (
  { kind: 'entries'; entries: Entry[] } | { kind: 'skills'; items: { label: string; text: string }[] } | { kind: 'lines'; blocks: Block[] }
);
export interface ResumeDocument {
  schemaVersion: '0.2.0'; locale?: 'zh-CN';
  person: { name: string; target: string; label?: string; availability?: string; contacts: Contact[] };
  assets?: { schoolLogo?: Asset; portrait?: Asset }; sections: Section[]; notice?: string;
}
export interface ImageConfig { enabled?: boolean; widthMm?: number; heightMm?: number; slot?: 'start' | 'end'; align?: 'top' | 'center' | 'bottom' }
export interface LayoutConfig {
  schemaVersion: '0.2.0'; theme?: 'ink-blue'; preset?: 'campus' | 'experience';
  page?: { size?: 'A4'; marginMm?: number; maxPages?: 1 | 2 };
  bodyPt?: number; lineHeight?: number; namePt?: number; accent?: string; sectionOrder?: string[];
  header?: { gapMm?: number }; spacing?: { sectionMm?: number; entryMm?: number };
  images?: { schoolLogo?: ImageConfig; portrait?: ImageConfig };
}
export type NormalizedDocument = ResumeDocument & { locale: 'zh-CN'; assets: NonNullable<ResumeDocument['assets']> };
export type NormalizedLayout = Required<Omit<LayoutConfig, 'page' | 'images' | 'header' | 'spacing'>> & {
  page: Required<NonNullable<LayoutConfig['page']>>; header: Required<NonNullable<LayoutConfig['header']>>;
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
export interface ErrorDetails { file?: string; line?: number; field?: string; code?: string }
export class ResumeError extends Error {
  constructor(message: string, details?: ErrorDetails);
  file?: string; line?: number; field?: string; code: string;
  toString(): string; toJSON(): ErrorDetails & { code: string; message: string };
}
export function parseResume(source: string, file?: string): { document: NormalizedDocument; locations: Locations };
export function loadResume(inputPath: string, configPath?: string): Promise<LoadedResume>;
export function parseResumeJson(source: string, file?: string): Pick<LoadedResume, 'document' | 'layout' | 'locations' | 'layoutLocations'>;
export function loadResumeJson(inputPath: string, options?: { assetBase?: string }): Promise<LoadedResume>;
export function renderResume(document: ResumeDocument, layout: LayoutConfig, options?: RenderOptions): Promise<RenderedResume>;
export function inspectAndExport(rendered: RenderedResume, options: { pdf: true }): Promise<PdfExportResult>;
export function inspectAndExport(rendered: RenderedResume, options?: { pdf?: false }): Promise<ExportResult>;
export function inspectAndExport(rendered: RenderedResume, options: { pdf: boolean }): Promise<ExportResult | PdfExportResult>;
export function initializeProject(directory: string, template?: 'campus' | 'experience' | 'blank'): Promise<string>;
