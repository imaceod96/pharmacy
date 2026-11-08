import { runInventoryTests } from './inventory.test';
import { runSalesTests } from './sales.test';
import { runFifoTests } from './fifo.test';
import { runWorkdayTests } from './workdays.test';
import { runCutsAndInventoryTests } from './cuts_inventory.test';
import { runConcurrencyTests } from './concurrency.test';
import { runSecurityTests } from './security.test';
import { runBackupTests } from './backup.test';
import { runPinSecurityTests } from './pin_security.test';
import { runPrintingAndBackupTests } from './printing_backup.test';
import { runPerformanceOptimizationTests } from './performance_optimization.test';
import { runExcelInventoryTests } from './excel_inventory.test';
import { runExpensesTests } from './expenses.test';
import { runVolumePerformanceBenchmarks, PerformanceBenchmarkResult } from './volume.test';
import { TestSuiteResult } from './testUtils';

async function main() {
  console.log('================================================================');
  console.log('   FASE 10 — BLOQUE 10.5: OPTIMIZACIÓN Y ESTABILIDAD OPERATIVA   ');
  console.log('================================================================');
  console.log('Ejecutando pruebas sobre instancias de prueba aisladas (fake-indexeddb)...\n');

  const suiteRunners = [
    runInventoryTests,
    runSalesTests,
    runFifoTests,
    runWorkdayTests,
    runCutsAndInventoryTests,
    runConcurrencyTests,
    runSecurityTests,
    runBackupTests,
    runPinSecurityTests,
    runPrintingAndBackupTests,
    runPerformanceOptimizationTests,
    runExcelInventoryTests,
    runExpensesTests,
  ];

  const results: TestSuiteResult[] = [];
  let totalExecuted = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  const globalStart = Date.now();

  for (const runner of suiteRunners) {
    try {
      const suiteResult = await runner();
      results.push(suiteResult);
      totalExecuted += suiteResult.total;
      totalPassed += suiteResult.passed;
      totalFailed += suiteResult.failed;

      console.log(`\n📦 SUITE: ${suiteResult.name} (${suiteResult.durationMs}ms)`);
      console.log(`   Aprobadas: ${suiteResult.passed}/${suiteResult.total}`);

      for (const t of suiteResult.tests) {
        if (t.passed) {
          console.log(`   ✓ [PASSED] ${t.name} (${t.durationMs}ms)`);
        } else {
          console.log(`   ✗ [FAILED] ${t.name} (${t.durationMs}ms)`);
          console.log(`     Error: ${t.error}`);
        }
      }
    } catch (err: any) {
      console.error(`Error crítico ejecutando suite: ${err?.message}`);
    }
  }

  // Ejecutar Suite de Volumen y Rendimiento (100, 1000, 5000 productos)
  let volumeBenchmarks: readonly PerformanceBenchmarkResult[] = [];
  try {
    const { suiteResult, benchmarks } = await runVolumePerformanceBenchmarks();
    results.push(suiteResult);
    volumeBenchmarks = benchmarks;
    totalExecuted += suiteResult.total;
    totalPassed += suiteResult.passed;
    totalFailed += suiteResult.failed;

    console.log(`\n📦 SUITE: ${suiteResult.name} (${suiteResult.durationMs}ms)`);
    console.log(`   Aprobadas: ${suiteResult.passed}/${suiteResult.total}`);

    for (const t of suiteResult.tests) {
      if (t.passed) {
        console.log(`   ✓ [PASSED] ${t.name} (${t.durationMs}ms)`);
      } else {
        console.log(`   ✗ [FAILED] ${t.name} (${t.durationMs}ms)`);
        console.log(`     Error: ${t.error}`);
      }
    }
  } catch (err: any) {
    console.error(`Error en suite de rendimiento: ${err?.message}`);
  }

  const globalDurationMs = Date.now() - globalStart;

  if (volumeBenchmarks.length > 0) {
    console.log('\n================================================================');
    console.log('       MÉTRICAS DE RENDIMIENTO Y RENDIMIENTO VOLUMÉTRICO       ');
    console.log('================================================================');
    console.log('Volumen\tPoblado\tCatálogo\tBúsqueda\tKardex\tInforme\tExportación\tRestauración');
    for (const b of volumeBenchmarks) {
      console.log(
        `${b.productCount}\t${b.seedTimeMs}ms\t${b.catalogLoadTimeMs}ms\t\t${b.searchTimeMs}ms\t\t${b.kardexQueryTimeMs}ms\t${b.reportGenTimeMs}ms\t${b.backupExportTimeMs}ms\t\t${b.backupRestoreTimeMs}ms`
      );
    }
  }

  console.log('\n================================================================');
  console.log('                 RESUMEN GENERAL DE EJECUCIÓN                    ');
  console.log('================================================================');
  console.log(`Pruebas totales ejecutadas: ${totalExecuted}`);
  console.log(`Pruebas APROBADAS:         ${totalPassed}`);
  console.log(`Pruebas FALLIDAS:          ${totalFailed}`);
  console.log(`Tiempo total de ejecución: ${globalDurationMs} ms`);
  console.log('================================================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fallo en ejecutor maestro de pruebas:', err);
  process.exit(1);
});
