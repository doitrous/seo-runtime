<title>{{ $seo['title'] }}</title>
@if ($seo['description'] !== '')<meta name="description" content="{{ $seo['description'] }}">@endif
@if ($seo['canonical'] !== '')<link rel="canonical" href="{{ $seo['canonical'] }}">@endif
@foreach ($seo['alternates'] as $lang => $href)
<link rel="alternate" hreflang="{{ $lang }}" href="{{ $href }}">
@endforeach
<meta name="robots" content="{{ $seo['robots']['index'] ? 'index' : 'noindex' }}, {{ $seo['robots']['follow'] ? 'follow' : 'nofollow' }}">
@if ($seo['og']['title'] !== '')<meta property="og:title" content="{{ $seo['og']['title'] }}">@endif
@if ($seo['og']['description'] !== '')<meta property="og:description" content="{{ $seo['og']['description'] }}">@endif
@if ($seo['canonical'] !== '')<meta property="og:url" content="{{ $seo['canonical'] }}">@endif
@if ($seo['og']['image'] !== '')<meta property="og:image" content="{{ $seo['og']['image'] }}">@endif
<meta name="twitter:card" content="{{ $seo['twitter']['image'] !== '' ? 'summary_large_image' : 'summary' }}">
@if ($seo['twitter']['title'] !== '')<meta name="twitter:title" content="{{ $seo['twitter']['title'] }}">@endif
@if ($seo['twitter']['description'] !== '')<meta name="twitter:description" content="{{ $seo['twitter']['description'] }}">@endif
@if ($seo['twitter']['image'] !== '')<meta name="twitter:image" content="{{ $seo['twitter']['image'] }}">@endif
{!! \Doitrous\SeoRuntime\Support\Snapshot::jsonLdScript($seo['jsonld']) !!}
