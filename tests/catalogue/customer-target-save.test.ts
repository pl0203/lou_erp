import { test } from 'vitest'
import { createCustomerTargetSender } from '../../src/lib/catalogue/customerTargets'
import { registerCustomerTargetTests } from './customer-target-cases.mjs'
// Same assertions as the no-install Node 24 runner, under the normal app suite.
registerCustomerTargetTests(test, createCustomerTargetSender)
