import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('configure_google', Path(__file__).parents[1] / 'deploy' / 'configure-google.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class GoogleSetupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.target = Path(self.tmp.name) / 'webmind.env'
        self.original = '# Preserve comments\nAUTH_SECRET=existing-secret\nSMTP_PASS=existing-mail\nEMAIL_AUTH_ENABLED=true\nGOOGLE_CLIENT_ID=old\nGOOGLE_CLIENT_ID=duplicate\n'
        self.target.write_text(self.original, encoding='utf-8')
        self.values = {
            'GOOGLE_CLIENT_ID': '123-test.apps.googleusercontent.com',
            'GOOGLE_CLIENT_SECRET': 'test-only-client-secret-value',
            'GOOGLE_PICKER_API_KEY': 'AIza' + 'test-only-value-' * 3,
            'GOOGLE_PROJECT_NUMBER': '123',
        }
        self.target_patch = patch.object(setup, 'TARGET', self.target)
        self.target_patch.start()
        self.addCleanup(self.target_patch.stop)
        # Windows lacks chown; production uses the real Linux operation.
        self.chown_patch = patch.object(setup.os, 'chown', create=True)
        self.chown_patch.start()
        self.addCleanup(self.chown_patch.stop)

    def test_success_preserves_mail_and_auth_and_creates_backup(self):
        with patch.object(setup, 'restart'), patch.object(setup, 'healthy', return_value=True):
            setup.apply(self.values)
        actual = self.target.read_text(encoding='utf-8')
        self.assertIn('SMTP_PASS=existing-mail\n', actual)
        self.assertIn('AUTH_SECRET=existing-secret\n', actual)
        self.assertIn('EMAIL_AUTH_ENABLED=true\n', actual)
        self.assertEqual(actual.count('GOOGLE_CLIENT_ID='), 1)
        self.assertEqual(list(self.target.parent.glob('*.before-google-*'))[0].read_text(encoding='utf-8'), self.original)

    def test_failed_health_restores_entire_previous_config(self):
        with patch.object(setup, 'restart') as restart, patch.object(setup, 'healthy', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'previous settings restored'):
                setup.apply(self.values)
        self.assertEqual(self.target.read_text(encoding='utf-8'), self.original)
        self.assertEqual(restart.call_count, 2)

    def test_interrupted_restart_restores_previous_config(self):
        with patch.object(setup, 'restart', side_effect=[KeyboardInterrupt(), None]):
            with self.assertRaisesRegex(RuntimeError, 'previous settings restored'):
                setup.apply(self.values)
        self.assertEqual(self.target.read_text(encoding='utf-8'), self.original)

    def test_mixed_projects_and_injected_values_are_rejected(self):
        setup.validate(self.values, '123')
        with self.assertRaises(ValueError):
            setup.validate(self.values, '999')
        for value in ('secret\nSMTP_PASS=overwrite', 'secret"', '$(command)'):
            with self.assertRaises(ValueError):
                setup.validate({**self.values, 'GOOGLE_CLIENT_SECRET': value}, '123')


if __name__ == '__main__':
    unittest.main()
