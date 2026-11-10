/** 公開月ルールは shared/report-period.ts に一元化 (後方互換のための再エクスポート) */
export {
  isPublishedReportMonth,
  latestPublishedReportPath,
} from "../../../shared/report-period";
