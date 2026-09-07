<?php

namespace Doitrous\SeoRuntime;

use Doitrous\SeoRuntime\Http\Middleware\SeoBodyLimit;
use Doitrous\SeoRuntime\Http\Middleware\SeoRedirects;
use Doitrous\SeoRuntime\Http\Middleware\SeoSecret;
use Doitrous\SeoRuntime\Store\EloquentStore;
use Illuminate\Console\Scheduling\Schedule;
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

        // CONTRACT: pull on boot and every 6 h, health hourly. Registered here so a host app only
        // needs a running scheduler (`php artisan schedule:work` / the cron entry), no extra code.
        $this->callAfterResolving(Schedule::class, function (Schedule $schedule) {
            $schedule->call(fn () => $this->app->make(SeoManager::class)->pull())->cron('0 */6 * * *')->name('seo-runtime:pull')->withoutOverlapping();
            $schedule->call(fn () => $this->app->make(SeoManager::class)->sendHealth())->hourly()->name('seo-runtime:health')->withoutOverlapping();
        });

        if ($this->app->runningInConsole()) {
            $this->publishes([__DIR__ . '/../config/seo-runtime.php' => config_path('seo-runtime.php')], 'seo-runtime-config');
            $this->publishes([__DIR__ . '/../resources/views' => resource_path('views/vendor/seo-runtime')], 'seo-runtime-views');
        }
    }
}
