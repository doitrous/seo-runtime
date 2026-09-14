<?php

namespace Doitrous\SeoRuntime;

use Illuminate\Support\Facades\Facade;

/**
 * @method static array|null snapshot()
 * @method static array apply(mixed $incoming)
 * @method static array resolve(string $path, string $lang)
 * @method static string head(string $path, string $lang)
 * @method static array|null redirect(string $path)
 * @method static string sitemapXml()
 * @method static string robotsTxt()
 * @method static array pages()
 * @method static array health()
 * @method static array ingest(mixed $payload)
 * @method static array|null author(string $slug)
 * @method static array|null helpEntry(string $slug, string $lang)
 * @method static array|null tool(string $slug, string $lang)
 * @method static string|null indexNowKeyFile(string $path)
 * @method static array pending()
 * @method static array approvalAction(string $action, string $jobId, string $approvedBy, ?string $note = null)
 * @method static array indexNow(array $urlList)
 * @method static array vitals(array $sample)
 */
class Seo extends Facade
{
    protected static function getFacadeAccessor(): string { return SeoManager::class; }
}
