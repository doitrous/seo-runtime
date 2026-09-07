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
 */
class Seo extends Facade
{
    protected static function getFacadeAccessor(): string { return SeoManager::class; }
}
