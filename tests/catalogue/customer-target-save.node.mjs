import { test } from 'node:test'
import { createCustomerTargetSender } from '../../src/lib/catalogue/customerTargets.ts'
import { registerCustomerTargetTests } from './customer-target-cases.mjs'
registerCustomerTargetTests(test, createCustomerTargetSender)
