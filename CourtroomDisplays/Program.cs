using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

app.UseStaticFiles();

const string defaultDiv = "CRM";
const string lockedDisplayIp = "10.16.46.36";
const string ipMapFile = "Ip-map.json";
const string displayFile = "wwwroot/Display.html";
const string scheduleFile = "data/schedule.csv";

string[] SplitCsvLine(string line)
{
    var fields = new List<string>();
    var current = "";
    var inQuotes = false;

    for (var i = 0; i < line.Length; i++)
    {
        if (line[i] == '"')
        {
            inQuotes = !inQuotes;
            continue;
        }

        if (line[i] == ',' && !inQuotes)
        {
            fields.Add(current);
            current = "";
            continue;
        }

        current += line[i];
    }

    fields.Add(current);

    return fields.ToArray();
}

List<Dictionary<string, string>>? GetSchedule()
{
    var schedulePath = Path.Combine(
        app.Environment.ContentRootPath,
        scheduleFile);

    if (!File.Exists(schedulePath))
    {
        return null;
    }

    try
    {
        var raw = File.ReadAllText(schedulePath);
        var lines = raw.Trim().Split(
            new[] { "\r\n", "\n" },
            StringSplitOptions.None);

        if (lines.Length < 2)
        {
            return new List<Dictionary<string, string>>();
        }

        var headers = SplitCsvLine(lines[0])
            .Select(h => h.Trim())
            .ToArray();

        return lines
            .Skip(1)
            .Where(line => !string.IsNullOrWhiteSpace(line))
            .Select(line =>
            {
                var fields = SplitCsvLine(line);
                var row = new Dictionary<string, string>();

                for (var i = 0; i < headers.Length; i++)
                {
                    row[headers[i]] =
                        i < fields.Length
                            ? fields[i].Trim()
                            : "";
                }

                return row;
            })
            .ToList();
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "[csv] parse error");
        return null;
    }
}

List<Dictionary<string, string>>? GetRowsForDiv(string div)
{
    var all = GetSchedule();

    if (all == null)
    {
        return null;
    }

    div = (div ?? "").Trim().ToUpperInvariant();

    var divGroups = new Dictionary<string, string[]>
    {
        ["CRM"] = new[] { "6", "27" }
    };

    var isCombined = divGroups.ContainsKey(div);

    var allowedDivs = isCombined
        ? divGroups[div]
        : new[] { div };

    var rows = all
        .Where(row =>
            allowedDivs.Contains(
                row.TryGetValue("DIV", out var rowDiv)
                    ? rowDiv.Trim()
                    : ""))
        .Select(row =>
        {
            if (!isCombined)
            {
                return new Dictionary<string, string>(row);
            }

            var result = new Dictionary<string, string>(row);

            var rowDiv = row.TryGetValue("DIV", out var value)
                ? value.Trim()
                : "";

            result["DISPLAY DIV"] = rowDiv;
            result["DIV CLASS"] = "div-" + rowDiv;

            return result;
        })
        .ToList();

    rows.Sort((a, b) =>
    {
        var startA = a.TryGetValue("START TIME", out var valueA)
            ? valueA
            : "";

        var startB = b.TryGetValue("START TIME", out var valueB)
            ? valueB
            : "";

        return string.CompareOrdinal(startA, startB);
    });

    return rows;
}

string? GetScheduleDate()
{
    var all = GetSchedule();

    if (all == null || all.Count == 0)
    {
        return null;
    }

    var row = all.FirstOrDefault(r =>
        r.TryGetValue("SCHEDULE", out var value) &&
        !string.IsNullOrWhiteSpace(value));

    if (row == null)
    {
        return null;
    }

    var valueText = row["SCHEDULE"].Trim();

    // Excel serial date.
    if (double.TryParse(
        valueText,
        System.Globalization.NumberStyles.Float,
        System.Globalization.CultureInfo.InvariantCulture,
        out var serial))
    {
        var date = new DateTime(
            1899,
            12,
            30,
            0,
            0,
            0,
            DateTimeKind.Utc)
            .AddDays(serial);

        return date.ToString(
            "yyyy-MM-dd",
            System.Globalization.CultureInfo.InvariantCulture);
    }

    // Otherwise assume M/D/YY or M/D/YYYY.
    var parts = valueText.Split('/');

    if (parts.Length == 3 &&
        int.TryParse(parts[0], out var month) &&
        int.TryParse(parts[1], out var day) &&
        int.TryParse(parts[2], out var year))
    {
        if (year < 100)
        {
            year += 2000;
        }

        return $"{year:D4}-{month:D2}-{day:D2}";
    }

    return valueText;
}

app.MapGet("/dm.json", (HttpContext context) =>
{
    // URL parameter overrides IP mapping.
    var divParameter = context.Request.Query["div"].FirstOrDefault();

    string? div = null;

    if (!string.IsNullOrWhiteSpace(divParameter))
    {
        div = divParameter.Trim().ToUpperInvariant();
    }
    else
    {
        // Get client IP.
        var forwardedFor = context.Request.Headers["X-Forwarded-For"]
            .FirstOrDefault();

        string clientIp;

        if (!string.IsNullOrWhiteSpace(forwardedFor))
        {
            clientIp = forwardedFor
                .Split(',', StringSplitOptions.RemoveEmptyEntries)[0]
                .Trim();
        }
        else
        {
            clientIp =
                context.Connection.RemoteIpAddress?.ToString()
                ?? string.Empty;
        }

        if (clientIp.StartsWith(
            "::ffff:",
            StringComparison.OrdinalIgnoreCase))
        {
            clientIp = clientIp["::ffff:".Length..];
        }

        // Check IP mapping.
        var ipMapPath = Path.Combine(
            app.Environment.ContentRootPath,
            ipMapFile);

        if (File.Exists(ipMapPath))
        {
            try
            {
                var json = File.ReadAllText(ipMapPath);

                var map =
                    JsonSerializer.Deserialize<Dictionary<string, string>>(
                        json);

                if (map != null &&
                    map.TryGetValue(clientIp, out var mappedDiv) &&
                    !string.IsNullOrWhiteSpace(mappedDiv))
                {
                    div = mappedDiv.Trim().ToUpperInvariant();
                }
            }
            catch (Exception ex)
            {
                app.Logger.LogError(ex, "[ip-map] parse error");
            }
        }

        div ??= defaultDiv;
    }

    if (string.IsNullOrWhiteSpace(div))
    {
        return Results.Json(
            new
            {
                error = "IP is not mapped to any division"
            },
            statusCode: 403);
    }

    var rows = GetRowsForDiv(div);

    if (rows == null)
    {
        return Results.Json(
            new
            {
                error = "No schedule loaded yet"
            },
            statusCode: 503);
    }

    return Results.Json(rows);
});

app.MapGet("/schedule-status", (HttpContext context) =>
{
    // URL parameter overrides IP mapping.
    var divParameter = context.Request.Query["div"].FirstOrDefault();

    string? div = null;

    if (!string.IsNullOrWhiteSpace(divParameter))
    {
        div = divParameter.Trim().ToUpperInvariant();
    }
    else
    {
        var forwardedFor = context.Request.Headers["X-Forwarded-For"]
            .FirstOrDefault();

        string clientIp;

        if (!string.IsNullOrWhiteSpace(forwardedFor))
        {
            clientIp = forwardedFor
                .Split(',', StringSplitOptions.RemoveEmptyEntries)[0]
                .Trim();
        }
        else
        {
            clientIp =
                context.Connection.RemoteIpAddress?.ToString()
                ?? string.Empty;
        }

        if (clientIp.StartsWith(
            "::ffff:",
            StringComparison.OrdinalIgnoreCase))
        {
            clientIp = clientIp["::ffff:".Length..];
        }

        var ipMapPath = Path.Combine(
            app.Environment.ContentRootPath,
            ipMapFile);

        if (File.Exists(ipMapPath))
        {
            try
            {
                var json = File.ReadAllText(ipMapPath);

                var map =
                    JsonSerializer.Deserialize<Dictionary<string, string>>(
                        json);

                if (map != null &&
                    map.TryGetValue(clientIp, out var mappedDiv) &&
                    !string.IsNullOrWhiteSpace(mappedDiv))
                {
                    div = mappedDiv.Trim().ToUpperInvariant();
                }
            }
            catch (Exception ex)
            {
                app.Logger.LogError(ex, "[ip-map] parse error");
            }
        }

        div ??= defaultDiv;
    }

    if (string.IsNullOrWhiteSpace(div))
    {
        return Results.Json(
            new
            {
                error = "IP is not mapped to any division"
            },
            statusCode: 403);
    }

    var scheduleDate = GetScheduleDate();

    var xlsxPath = Path.Combine(
        app.Environment.ContentRootPath,
        "data",
        "DisplayDocket.xlsx");

    string? modified = null;

    if (File.Exists(xlsxPath))
    {
        modified = File.GetLastWriteTimeUtc(xlsxPath)
            .ToString("O");
    }

    return Results.Json(new
    {
        scheduleDate,
        modified
    });
});

app.MapGet("/display", async (HttpContext context) =>
{
    // Get client IP.
    var forwardedFor = context.Request.Headers["X-Forwarded-For"].FirstOrDefault();

    string clientIp;

    if (!string.IsNullOrWhiteSpace(forwardedFor))
    {
        clientIp = forwardedFor
            .Split(',', StringSplitOptions.RemoveEmptyEntries)[0]
            .Trim();
    }
    else
    {
        clientIp = context.Connection.RemoteIpAddress?.ToString() ?? string.Empty;
    }

    // Strip IPv4-mapped IPv6 prefix, matching the Node.js behavior.
    if (clientIp.StartsWith("::ffff:", StringComparison.OrdinalIgnoreCase))
    {
        clientIp = clientIp["::ffff:".Length..];
    }

    // URL parameter overrides IP mapping.
    var divParameter = context.Request.Query["div"].FirstOrDefault();

    string? div = null;

    if (!string.IsNullOrWhiteSpace(divParameter))
    {
        div = divParameter.Trim().ToUpperInvariant();
    }
    else
    {
        // Check IP mapping.
        var ipMapPath = Path.Combine(app.Environment.ContentRootPath, ipMapFile);

        if (File.Exists(ipMapPath))
        {
            try
            {
                var json = await File.ReadAllTextAsync(ipMapPath);

                var map = System.Text.Json.JsonSerializer.Deserialize<
                    Dictionary<string, string>>(json);

                if (map != null &&
                    map.TryGetValue(clientIp, out var mappedDiv) &&
                    !string.IsNullOrWhiteSpace(mappedDiv))
                {
                    div = mappedDiv.Trim().ToUpperInvariant();
                }
            }
            catch (Exception ex)
            {
                app.Logger.LogError(ex, "[ip-map] parse error");
            }
        }

        // Default for unmapped IPs.
        div ??= defaultDiv;
    }

    // This should only occur if the division somehow remains empty.
    if (string.IsNullOrWhiteSpace(div))
    {
        var unmappedHtml = $"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Unmapped Display</title>
            </head>
            <body>
                <h1>Display Not Mapped</h1>
                <p>Client IP: {clientIp}</p>
            </body>
            </html>
            """;

        return Results.Content(unmappedHtml, "text/html");
    }

    // Load display.html.
    var displayPath = Path.Combine(app.Environment.ContentRootPath, displayFile);

    if (!File.Exists(displayPath))
    {
        return Results.Problem("Display.html was not found.");
    }

    var html = await File.ReadAllTextAsync(displayPath);

    // Get layout parameter, defaulting to "table".
    var layout = context.Request.Query["layout"].FirstOrDefault() ?? "table";

    // Match the Node.js locked-display behavior.
    var isLockedDisplay = clientIp == lockedDisplayIp;

    // Inject the same values into Display.html.
    var originalScript =
        "window.COURT_DIV = new URLSearchParams(window.location.search).get('div') || '';";

    var replacementScript = $"""
        window.COURT_DIV = '{div}';
        window.COURT_LAYOUT = '{layout}';
        window.DISPLAY_LOCKED = {isLockedDisplay.ToString().ToLowerInvariant()};
        """;

    html = html.Replace(originalScript, replacementScript);

    return Results.Content(html, "text/html");
});

app.MapGet("/", () => "Hello World!");

app.Run();