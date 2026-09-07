<?php

namespace Doitrous\SeoRuntime;

use Doitrous\SeoRuntime\Http\Middleware\SeoBodyLimit;
use Doitrous\SeoRuntime\Http\Middleware\SeoRedirects;
use Doitrous\SeoRuntime\Http\Middleware\SeoSecret;
use Doitrous\SeoRuntime\Store\EloquentStore;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\ServiceProvider;

class SeoRuntimeServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../config/seo-runtime.php', 'seo-runtime');
        $this->app->singleton(SeoManager::class, fn () => new SeoManager(new EloquentStore()));
    }

    public function boot(Router $router): void
    {
        $this->loadMigrationsFrom(__DIR__ . '/../database/migrations');
        $this->loadRoutesFrom(__DIR__ . '/../routes/seo.php');
        $this->loadViewsFrom(__DIR__ . '/../resources/views', 'seo-runtime');

        $router->aliasMiddleware('seo.secret', SeoSecret::class);
        $router->aliasMiddleware('seo.body', SeoBodyLimit::class);
        $router->aliasMiddleware('seo.redirects', SeoRedirects::class);

        Blade::directive('seoHead', fn ($expression) => "<?php echo \\Doitrous\\SeoRuntime\\Seo::head($expression); ?>");

        if ($this->app->runningInConsole()) {
            $this->publishes([__DIR__ . '/../config/seo-runtime.php' => config_path('seo-runtime.php')], 'seo-runtime-config');
            $this->publishes([__DIR__ . '/../resources/views' => resource_path('views/vendor/seo-runtime')], 'seo-runtime-views');
        }
    }
}
