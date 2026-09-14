<?php

if (!defined('ABSPATH')) exit;

/**
 * v2: pending/approve proxy. This site's own secret in (doitrous_seo_authorized(), via
 * routes.php); the hub's runtime secret out. `null`/misconfigured cases answer 502, the same
 * shape core-js's `proxyPending`/`proxyApprovalAction` use.
 */
function doitrous_seo_slug_for_proxy(): string {
    $cfg = doitrous_seo_config();

    return $cfg['slug'] ?: (string) (doitrous_seo_get_snapshot()['siteSlug'] ?? '');
}

function doitrous_seo_hub_proxy(string $method, string $path, array $body = []): array {
    $cfg = doitrous_seo_config();
    $slug = doitrous_seo_slug_for_proxy();
    if ($cfg['hubUrl'] === '' || $cfg['secret'] === '' || $slug === '') {
        return ['status' => 502, 'body' => ['error' => 'misconfigured']];
    }
    $args = ['headers' => ['Authorization' => 'Bearer ' . $cfg['secret']], 'timeout' => 15];
    if ($method === 'post') {
        $args['headers']['Content-Type'] = 'application/json';
        $args['body'] = wp_json_encode($body);
        $res = wp_remote_post($cfg['hubUrl'] . $path, $args);
    } else {
        $res = wp_remote_get($cfg['hubUrl'] . $path, $args);
    }
    if (is_wp_error($res)) return ['status' => 502, 'body' => ['error' => 'hub_unreachable']];
    $decoded = json_decode(wp_remote_retrieve_body($res), true);

    return ['status' => wp_remote_retrieve_response_code($res), 'body' => $decoded ?? wp_remote_retrieve_body($res)];
}

function doitrous_seo_pending(): array {
    return doitrous_seo_hub_proxy('get', '/api/sites/' . rawurlencode(doitrous_seo_slug_for_proxy()) . '/pending');
}

function doitrous_seo_approval_action(string $action, string $jobId, string $approvedBy, ?string $note = null): array {
    if ($jobId === '' || $approvedBy === '') return ['status' => 400, 'body' => ['error' => 'invalid']];
    $path = '/api/sites/' . rawurlencode(doitrous_seo_slug_for_proxy()) . '/jobs/' . rawurlencode($jobId) . "/$action";
    $body = ['approvedBy' => $approvedBy];
    if ($note !== null) $body['note'] = $note;

    return doitrous_seo_hub_proxy('post', $path, $body);
}

function doitrous_seo_route_pending(): void {
    $out = doitrous_seo_pending();
    doitrous_seo_json($out['body'], $out['status']);
}

function doitrous_seo_route_approval_action(string $action): void {
    $body = (array) doitrous_seo_read_body();
    $out = doitrous_seo_approval_action($action, (string) ($body['jobId'] ?? ''), (string) ($body['approvedBy'] ?? ''), $body['note'] ?? null);
    doitrous_seo_json($out['body'], $out['status']);
}

/**
 * v2: IndexNow. This site's own secret in (doitrous_seo_authorized(), via routes.php), then
 * forwards `urlList` to api.indexnow.org with settings.indexNowKey — the same key served at
 * `/{key}.txt` (doitrous_seo_index_now_key_file(), in entities.php), which is what lets
 * IndexNow's own key verification succeed. Every URL must share the batch's host (IndexNow's
 * own rule); a mismatched one is dropped rather than sent, since IndexNow rejects the whole
 * batch on a host mismatch.
 */
function doitrous_seo_index_now(array $urlList): array {
    $settings = doitrous_seo_get_settings() ?? DOITROUS_SEO_EMPTY_SETTINGS;
    $key = $settings['indexNowKey'] ?? null;
    if (!$key) return ['status' => 502, 'body' => ['error' => 'misconfigured']];
    if (empty($urlList)) return ['status' => 400, 'body' => ['error' => 'invalid']];
    $host = parse_url((string) $urlList[0], PHP_URL_HOST);
    if (!$host) return ['status' => 400, 'body' => ['error' => 'invalid']];
    $urls = array_values(array_filter($urlList, fn ($u) => parse_url((string) $u, PHP_URL_HOST) === $host));
    if (empty($urls)) return ['status' => 400, 'body' => ['error' => 'invalid']];
    $res = wp_remote_post('https://api.indexnow.org/indexnow', [
        'headers' => ['Content-Type' => 'application/json'],
        'body' => wp_json_encode(['host' => $host, 'key' => $key, 'keyLocation' => "https://$host/$key.txt", 'urlList' => $urls]),
        'timeout' => 15,
    ]);
    if (is_wp_error($res)) return ['status' => 502, 'body' => ['error' => 'indexnow_unreachable']];
    $decoded = json_decode(wp_remote_retrieve_body($res), true);

    return ['status' => wp_remote_retrieve_response_code($res), 'body' => $decoded ?? wp_remote_retrieve_body($res)];
}

function doitrous_seo_route_index_now(): void {
    $body = (array) doitrous_seo_read_body();
    $out = doitrous_seo_index_now((array) ($body['urlList'] ?? []));
    doitrous_seo_json($out['body'], $out['status']);
}

/**
 * v2: the opt-in web-vitals beacon (doitrous_seo_web_vitals_snippet(), in entities.php) posts
 * here with NO secret — it runs in a real visitor's browser, which is not a place to keep this
 * site's secret. The secret is attached only on the way OUT, to the hub, via the same
 * doitrous_seo_hub_proxy() every other hub-proxy call in this file uses.
 */
function doitrous_seo_vitals(array $sample): array {
    $cfg = doitrous_seo_config();
    if ($cfg['hubUrl'] === '' || $cfg['secret'] === '') return ['status' => 502, 'body' => ['error' => 'misconfigured']];
    if (empty($sample['url'])) return ['status' => 400, 'body' => ['error' => 'invalid']];
    $slug = doitrous_seo_slug_for_proxy();
    if ($slug === '') return ['status' => 502, 'body' => ['error' => 'misconfigured']];

    return doitrous_seo_hub_proxy('post', '/api/runtime/vitals', [
        'siteSlug' => $slug, 'url' => $sample['url'],
        'lcp' => $sample['lcp'] ?? null, 'inp' => $sample['inp'] ?? null, 'cls' => $sample['cls'] ?? null,
        'source' => 'rum',
    ]);
}

/** Anonymous (routes.php never gates this one behind doitrous_seo_authorized()). */
function doitrous_seo_route_vitals(): void {
    $body = (array) doitrous_seo_read_body();
    $out = doitrous_seo_vitals([
        'url' => (string) ($body['url'] ?? ''),
        'lcp' => $body['lcp'] ?? null, 'inp' => $body['inp'] ?? null, 'cls' => $body['cls'] ?? null,
    ]);
    doitrous_seo_json($out['body'], $out['status']);
}

/**
 * v2: the minimal admin panel, as a WordPress admin submenu page — behind WP's own login
 * (`manage_options`) rather than the runtime secret, since a logged-in admin already has one.
 * It still talks to the SAME bearer-secret `/api/seo/pending` etc. proxy routes every other
 * stack's panel uses, with the secret templated in (see includes/routes.php's own docblock on
 * `/seo-admin`-style panels for why: no other channel reaches those routes from a browser).
 */
function doitrous_seo_register_admin_menu(): void {
    add_menu_page('SEO Approvals', 'SEO Approvals', 'manage_options', 'doitrous-seo-approvals', 'doitrous_seo_render_admin_page');
}

function doitrous_seo_render_admin_page(): void {
    if (!current_user_can('manage_options')) { wp_die('unauthorized'); }
    $secret = doitrous_seo_config()['secret'];
    // '<' -> < so the templated secret can never close this <script> tag early — same rule
    // as every other JSON-LD/head-tag escape in this plugin.
    $secretJs = str_replace('<', '\u003c', wp_json_encode($secret));
    echo '<div class="wrap"><h1>SEO Approvals</h1>'
        . '<input id="doitrous-seo-approver" type="text" placeholder="Approver name" style="margin-bottom:1rem">'
        . '<table class="widefat" id="doitrous-seo-jobs"><thead><tr><th>Title</th><th>Lang</th><th>Publish at</th><th>Actions</th></tr></thead><tbody></tbody></table>'
        . '<p id="doitrous-seo-status"></p>'
        . '<script>(function(){'
        . 'var secret=' . $secretJs . ';'
        . 'var headers={Authorization:"Bearer "+secret,"Content-Type":"application/json"};'
        . 'var statusEl=document.getElementById("doitrous-seo-status");'
        . 'var approverEl=document.getElementById("doitrous-seo-approver");'
        . 'function load(){fetch("/api/seo/pending",{headers:headers}).then(function(r){return r.json().then(function(b){return[r,b];});}).then(function(rb){'
        . 'var r=rb[0],body=rb[1];var tbody=document.querySelector("#doitrous-seo-jobs tbody");tbody.innerHTML="";'
        . 'if(!r.ok){statusEl.textContent="Failed to load: "+(body.error||r.status);return;}'
        . '(body.jobs||[]).forEach(function(job){var tr=document.createElement("tr");'
        . 'function cell(t){var td=document.createElement("td");td.textContent=t||"";return td;}'
        . 'tr.appendChild(cell(job.title));tr.appendChild(cell(job.lang));tr.appendChild(cell(job.publishAt));'
        . 'var actions=document.createElement("td");'
        . 'if(job.previewUrl){var a=document.createElement("a");a.href=job.previewUrl;a.target="_blank";a.textContent="Preview";a.style.marginRight=".5rem";actions.appendChild(a);}'
        . '["approve","reject","publish-now"].forEach(function(action){var btn=document.createElement("button");btn.textContent=action;btn.onclick=function(){act(job.id,action);};actions.appendChild(btn);});'
        . 'tr.appendChild(actions);tbody.appendChild(tr);});});}'
        . 'function act(jobId,action){var approvedBy=approverEl.value.trim();if(!approvedBy){statusEl.textContent="Enter an approver name first.";return;}'
        . 'fetch("/api/seo/"+action,{method:"POST",headers:headers,body:JSON.stringify({jobId:jobId,approvedBy:approvedBy})}).then(function(r){return r.json().then(function(b){return[r,b];});}).then(function(rb){'
        . 'var r=rb[0],body=rb[1];statusEl.textContent=r.ok?(action+" ok: "+jobId):("failed: "+(body.reason||body.error||r.status));load();});}'
        . 'load();'
        . '})();</script></div>';
}
