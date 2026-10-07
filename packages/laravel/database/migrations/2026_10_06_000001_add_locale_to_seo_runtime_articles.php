<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 0.2.0, per-country pages (hub contract 1.20.0): one article row per (external_id, locale).
 *
 * `locale` is backfilled with `lang`, `is_lead` defaults to true (every 0.1.x row was the only
 * version of its language) and `hreflang` starts empty, so every existing article keeps its URL
 * and renders exactly as before. `locale` stays nullable at the schema level — making it NOT NULL
 * after the backfill needs `->change()`, which needs doctrine/dbal on Laravel 10 — and the store
 * treats a null locale as the row's language.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('seo_runtime_articles', function (Blueprint $table) {
            $table->string('locale', 35)->nullable();
            $table->boolean('is_lead')->default(true);
            $table->json('hreflang')->nullable();
        });

        DB::table('seo_runtime_articles')->whereNull('locale')->update(['locale' => DB::raw('lang')]);

        Schema::table('seo_runtime_articles', function (Blueprint $table) {
            $table->dropUnique(['external_id', 'lang']);
            $table->unique(['external_id', 'locale']);
            $table->index(['locale', 'slug']);   // findArticleBySlug() by locale: the 409 and every view
        });
    }

    public function down(): void
    {
        // Only the lead of each language fits the 0.1.x (external_id, lang) key.
        DB::table('seo_runtime_articles')->where('is_lead', false)->delete();

        Schema::table('seo_runtime_articles', function (Blueprint $table) {
            $table->dropIndex(['locale', 'slug']);
            $table->dropUnique(['external_id', 'locale']);
            $table->unique(['external_id', 'lang']);
        });
        Schema::table('seo_runtime_articles', function (Blueprint $table) {
            $table->dropColumn(['locale', 'is_lead', 'hreflang']);
        });
    }
};
