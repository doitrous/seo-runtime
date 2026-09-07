<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('seo_runtime_state', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedBigInteger('version')->default(0);
            $table->string('site_slug', 191)->default('');
            $table->json('settings');
            $table->timestamp('last_sync_at')->nullable();
        });

        Schema::create('seo_runtime_pages', function (Blueprint $table) {
            // page_key, never `key`: KEY is reserved in MySQL and TourMedX runs MySQL.
            $table->string('page_key', 191);
            $table->string('type', 64)->default('page');
            $table->string('lang', 16);
            $table->string('path', 191);
            $table->string('group_key', 191)->default('');
            $table->string('title', 500)->default('');
            $table->string('updated_at', 40)->default('');
            $table->json('seo');
            $table->unique(['lang', 'path']);
            $table->index('group_key');       // listGroup() is on the render path
        });

        Schema::create('seo_runtime_redirects', function (Blueprint $table) {
            $table->string('source', 191)->primary();
            $table->string('destination', 1000);
            $table->unsignedSmallInteger('type')->default(301);
            $table->boolean('active')->default(true);
            $table->unsignedBigInteger('hits')->default(0);
        });

        Schema::create('seo_runtime_articles', function (Blueprint $table) {
            $table->unsignedBigInteger('external_id');
            $table->string('lang', 16);
            $table->string('slug', 191);
            $table->string('title', 500);
            $table->string('meta_title', 500)->default('');
            $table->string('meta_description', 1000)->default('');
            $table->mediumText('body_md');
            $table->mediumText('body_html');
            $table->json('faq');
            $table->json('schema_jsonld');
            $table->string('image_url', 1000)->nullable();
            $table->string('image_alt', 500)->nullable();
            $table->string('author_name', 191)->nullable();
            $table->string('author_credentials', 191)->nullable();
            $table->json('refs');
            $table->json('og');
            $table->json('extra');           // the spec-1-only fields with no column of their own
            $table->string('published_at', 40)->default('');
            $table->string('updated_at', 40)->default('');
            $table->unique(['external_id', 'lang']);
            $table->index(['lang', 'slug']);  // findBySlug(), for the 409
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('seo_runtime_articles');
        Schema::dropIfExists('seo_runtime_redirects');
        Schema::dropIfExists('seo_runtime_pages');
        Schema::dropIfExists('seo_runtime_state');
    }
};
